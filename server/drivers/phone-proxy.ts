// First-party Android phone MCP server. It deliberately accepts physical USB
// devices only: no emulators, wireless debugging, network ADB, or Tailscale.
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { checkToolPermission, loadDiskPermissions } from "../permission-policy.ts";

type Json = Record<string, unknown>;
export type Device = { serial: string; state: string; model: string; connection: "usb" | "network" | "emulator" };
export type UiNode = {
  text: string;
  description: string;
  id: string;
  className: string;
  bounds: [number, number, number, number];
  clickable: boolean;
  focusable: boolean;
  focused: boolean;
  scrollable: boolean;
  editable: boolean;
  package: string;
};

export type PhoneErrorCode =
  | "APP_NOT_INSTALLED"
  | "APP_NOT_LAUNCHABLE"
  | "ANDROID_ACCESS_REQUIRED"
  | "TARGET_NOT_FOUND"
  | "ACTION_NOT_SUPPORTED"
  | "ACTION_FAILED"
  | "TIMEOUT"
  | "VERIFICATION_FAILED"
  | "PERMISSION_DENIED"
  | "UNKNOWN";

export class PhoneActionError extends Error {
  code: PhoneErrorCode;
  details?: Record<string, unknown>;

  constructor(code: PhoneErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PhoneActionError";
    this.code = code;
    this.details = details;
  }
}

export interface AppInfo {
  name: string;
  packageName: string;
  activity?: string;
  launchable: boolean;
  enabled: boolean;
}

export interface ScreenState {
  currentPackage: string;
  currentActivity?: string;
  nodeCount: number;
  nodes: UiNode[];
}

const MAX_ADB_OUTPUT = 16 * 1024 * 1024;
const PACKAGE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;
const COMPONENT = /^([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\/\S+$/;
export function normalizeInputText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/…/g, "...");
}

const SAFE_TEXT = /^[\x20-\x7E\r\n]+$/;
const KEYCODES: Record<string, string> = {
  app_switch: "KEYCODE_APP_SWITCH",
  back: "KEYCODE_BACK",
  delete: "KEYCODE_DEL",
  down: "KEYCODE_DPAD_DOWN",
  enter: "KEYCODE_ENTER",
  escape: "KEYCODE_BACK",
  home: "KEYCODE_HOME",
  left: "KEYCODE_DPAD_LEFT",
  recent: "KEYCODE_APP_SWITCH",
  recents: "KEYCODE_APP_SWITCH",
  return: "KEYCODE_ENTER",
  right: "KEYCODE_DPAD_RIGHT",
  space: "KEYCODE_SPACE",
  tab: "KEYCODE_TAB",
  up: "KEYCODE_DPAD_UP",
};

export function escapeInputText(text: string): string {
  const withSpaces = text.replaceAll(" ", "%s");
  return withSpaces.replace(/([$"'`;()<>|&*?~!#[\]{}^\\&])/g, "\\$1");
}

export function escapeShellComponent(component: string): string {
  return component.replaceAll("$", "\\$");
}

export const KNOWN_PACKAGES: Record<string, string> = {
  whatsapp: "com.whatsapp",
  settings: "com.android.settings",
  chrome: "com.android.chrome",
  browser: "com.android.chrome",
  maps: "com.google.android.apps.maps",
  googlemaps: "com.google.android.apps.maps",
  store: "com.android.vending",
  playstore: "com.android.vending",
  googleplay: "com.android.vending",
  youtube: "com.google.android.youtube",
  gmail: "com.google.android.gm",
  email: "com.google.android.gm",
  messages: "com.google.android.apps.messaging",
  sms: "com.google.android.apps.messaging",
  contacts: "com.samsung.android.app.contacts",
  camera: "com.sec.android.app.camera",
  clock: "com.sec.android.app.clockpackage",
  calculator: "com.sec.android.app.popupcalculator",
  files: "com.sec.android.app.myfiles",
  myfiles: "com.sec.android.app.myfiles",
  companion: "com.openmausbot.companion",
  mobot: "com.openmausbot.companion",
  mobotcompanion: "com.openmausbot.companion",
  openmausbot: "com.openmausbot.companion",
  openmausbotcompanion: "com.openmausbot.companion",
  skyscanner: "net.skyscanner.android.main",
  uber: "com.ubercab",
  spotify: "com.spotify.music",
  telegram: "org.telegram.messenger",
  instagram: "com.instagram.android",
  twitter: "com.twitter.android",
  x: "com.twitter.android",
};

export const HUMAN_LABELS: Record<string, string> = {
  "com.whatsapp": "WhatsApp",
  "com.whatsapp.w4b": "WhatsApp Business",
  "com.android.settings": "Settings",
  "com.android.chrome": "Chrome",
  "com.google.android.apps.maps": "Google Maps",
  "com.android.vending": "Google Play Store",
  "com.google.android.youtube": "YouTube",
  "com.google.android.gm": "Gmail",
  "com.google.android.apps.messaging": "Messages",
  "com.google.android.calendar": "Google Calendar",
  "com.google.android.calculator": "Google Calculator",
  "com.google.android.deskclock": "Google Clock",
  "com.google.android.apps.photos": "Google Photos",
  "com.google.android.apps.docs": "Google Drive",
  "com.samsung.android.app.contacts": "Contacts",
  "com.sec.android.app.camera": "Camera",
  "com.sec.android.app.clockpackage": "Clock",
  "com.sec.android.app.popupcalculator": "Calculator",
  "com.sec.android.app.myfiles": "My Files",
  "com.sec.android.gallery3d": "Gallery",
  "com.samsung.android.dialer": "Phone",
  "com.openmausbot.companion": "MOBOT Companion",
  "com.openmausbot.companion.preview": "MOBOT Companion Preview",
  "ai.x.grok.bot": "Grok",
  "com.anthropic.claude": "Claude",
  "com.openai.chatgpt": "ChatGPT",
  "com.deepseek.chat": "DeepSeek",
  "net.skyscanner.android.main": "Skyscanner",
  "com.ubercab": "Uber",
  "com.spotify.music": "Spotify",
  "org.telegram.messenger": "Telegram",
  "com.instagram.android": "Instagram",
  "com.twitter.android": "X",
  "com.discord": "Discord",
  "com.linkedin.android": "LinkedIn",
  "com.duolingo": "Duolingo",
  "com.chess": "Chess.com",
};

export function humanLabelForPackage(pkg: string): string {
  if (HUMAN_LABELS[pkg]) return HUMAN_LABELS[pkg];
  const parts = pkg.split(".");
  let last = parts[parts.length - 1];
  if ((last === "android" || last === "app" || last === "mobile" || last === "chat") && parts.length > 1) {
    last = parts[parts.length - 2];
  }
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function executableName(platform = process.platform) {
  return platform === "win32" ? "adb.exe" : "adb";
}

export function resolveAdbPath(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string | null {
  const executable = executableName(platform);
  const home = homedir();
  const candidates = [
    env.OMB_ADB_PATH,
    env.OMB_RESOURCES_PATH && join(env.OMB_RESOURCES_PATH, "android-platform-tools", platform, executable),
    ...(env.PATH ?? "").split(delimiter).map((entry) => entry && join(entry, executable)),
    platform === "darwin" && join(home, "Library/Android/sdk/platform-tools/adb"),
    platform === "darwin" && "/opt/homebrew/bin/adb",
    platform === "darwin" && "/usr/local/bin/adb",
    platform === "linux" && join(home, "Android/Sdk/platform-tools/adb"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

async function runAdb(args: string[], options: { binary?: boolean; timeoutMs?: number } = {}): Promise<Buffer> {
  const adb = resolveAdbPath();
  if (!adb) throw new PhoneActionError("ANDROID_ACCESS_REQUIRED", "Android platform tools are unavailable. Please install adb.");
  return new Promise((resolve, reject) => {
    const child = spawn(adb, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new PhoneActionError("TIMEOUT", "The Android device command timed out"));
    }, options.timeoutMs ?? 14_000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_ADB_OUTPUT) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new PhoneActionError("ACTION_FAILED", error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (size > MAX_ADB_OUTPUT) return reject(new PhoneActionError("ACTION_FAILED", "The Android device returned too much data"));
      if (code !== 0) {
        const errText = Buffer.concat(stderr).toString("utf8").trim() || `adb exited with code ${code}`;
        return reject(new PhoneActionError("ACTION_FAILED", errText));
      }
      resolve(Buffer.concat(stdout));
    });
  });
}

export function parseDevices(output: string): Device[] {
  const devices: Device[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("List of devices attached") || line.startsWith("* daemon")) continue;
    const [serial, state, ...fields] = line.split(/\s+/);
    if (!serial || !state) continue;
    const connection = serial.startsWith("emulator-")
      ? "emulator"
      : serial.includes(":") || serial.startsWith("adb-")
        ? "network"
        : "usb";
    const properties = Object.fromEntries(fields.flatMap((field) => {
      const split = field.indexOf(":");
      return split > 0 ? [[field.slice(0, split), field.slice(split + 1)]] : [];
    }));
    devices.push({
      serial,
      state,
      connection,
      model: String(properties.model ?? properties.product ?? "Android device").replaceAll("_", " "),
    });
  }
  return devices;
}

export async function usbDevices(): Promise<Device[]> {
  if (!resolveAdbPath()) return [];
  return parseDevices((await runAdb(["devices", "-l"])).toString("utf8")).filter((device) => device.connection === "usb");
}

export function isNativeDriverActive(): boolean {
  return Boolean(process.env.PH_DRIVER_PORT && Number(process.env.PH_DRIVER_PORT) > 0);
}

export async function callNativeDriver(endpoint: string, options: { method?: string; body?: unknown } = {}): Promise<any> {
  const port = process.env.PH_DRIVER_PORT;
  const token = process.env.PH_DRIVER_TOKEN || "";
  if (!port || Number(port) <= 0) {
    throw new PhoneActionError("ANDROID_ACCESS_REQUIRED", "Native phone driver is not active");
  }

  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new PhoneActionError("ACTION_FAILED", `Native driver error (HTTP ${res.status}): ${errText}`);
  }

  return await res.json();
}

export async function readySerial(requested?: unknown): Promise<string> {
  if (isNativeDriverActive()) {
    return "native-android";
  }
  const devices = await usbDevices();
  const serial = typeof requested === "string" && requested ? requested : process.env.PH_ANDROID_SERIAL;
  const candidates = serial ? devices.filter((device) => device.serial === serial) : devices;
  if (!candidates.length) {
    throw new PhoneActionError("ANDROID_ACCESS_REQUIRED", "No physical USB Android device is connected.");
  }
  if (candidates.length > 1 && !serial) {
    throw new PhoneActionError("ACTION_FAILED", "Multiple USB Android devices are connected; pass serial.");
  }
  const device = candidates[0];
  if (device.state === "unauthorized") {
    throw new PhoneActionError("ANDROID_ACCESS_REQUIRED", "Unlock the phone and accept 'Allow USB debugging'.");
  }
  if (device.state !== "device") {
    throw new PhoneActionError("ANDROID_ACCESS_REQUIRED", `The Android device is ${device.state}.`);
  }
  return device.serial;
}

export async function onDevice(serial: string, args: string[], binary = false): Promise<Buffer> {
  if (serial === "native-android") {
    const shellArgs = args[0] === "shell" ? args.slice(1) : args;
    const bin = shellArgs[0] === "cmd" ? "/system/bin/cmd" : shellArgs[0] === "pm" ? "/system/bin/pm" : shellArgs[0];
    const subArgs = shellArgs.slice(1);
    try {
      const { spawnSync } = await import("node:child_process");
      const res = spawnSync(bin, subArgs, { timeout: 10000 });
      if (res.stdout) return Buffer.from(res.stdout);
      return Buffer.from("");
    } catch {
      return Buffer.from("");
    }
  }
  return runAdb(["-s", serial, ...args], { binary });
}

export function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseLaunchablePackages(output: string): string[] {
  const packages: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const match = COMPONENT.exec(raw.trim());
    if (match && !packages.includes(match[1])) packages.push(match[1]);
  }
  return packages;
}

export function parseLaunchableActivities(output: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of output.split(/\r?\n/)) {
    const trimmed = raw.trim();
    const match = COMPONENT.exec(trimmed);
    if (match) {
      const [_, pkg] = match;
      if (!map.has(pkg)) {
        map.set(pkg, trimmed);
      }
    }
  }
  return map;
}

export function findPackages(name: string, packages: string[]): string[] {
  if (PACKAGE.test(name) && packages.includes(name)) return [name];
  const needle = normalize(name);
  const known = KNOWN_PACKAGES[needle];
  if (known && packages.includes(known)) return [known];
  if (needle.length < 3) return [];
  const ranked = [
    (token: string) => token === needle,
    (token: string) => token.startsWith(needle),
    (token: string) => token.includes(needle),
  ];
  for (const matches of ranked) {
    const found = packages.filter((pkg) => {
      const tokens = pkg.split(".").map((token) => normalize(token));
      const human = HUMAN_LABELS[pkg] ? normalize(HUMAN_LABELS[pkg]) : "";
      return (
        tokens.some((token) => matches(token)) ||
        matches(normalize(pkg)) ||
        (human ? matches(human) : false)
      );
    });
    if (found.length) return found;
  }
  return [];
}

export async function getInstalledPackages(serial: string): Promise<Set<string>> {
  try {
    const out = (await onDevice(serial, ["shell", "pm", "list", "packages", "--user", "0"])).toString("utf8");
    const pkgs = new Set<string>();
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith("package:")) {
        pkgs.add(line.slice("package:".length).trim());
      }
    }
    return pkgs;
  } catch {
    return new Set();
  }
}

export async function getEnabledPackages(serial: string): Promise<Set<string>> {
  try {
    const out = (await onDevice(serial, ["shell", "pm", "list", "packages", "-e", "--user", "0"])).toString("utf8");
    const pkgs = new Set<string>();
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith("package:")) {
        pkgs.add(line.slice("package:".length).trim());
      }
    }
    return pkgs;
  } catch {
    return new Set();
  }
}

export async function getForegroundActivity(serial: string): Promise<{ package: string; activity: string } | null> {
  try {
    const raw = (await onDevice(serial, ["shell", "dumpsys", "window"])).toString("utf8");
    const m = /mCurrentFocus=Window\{[^\s]+\s+(?:u\d+\s+)?([A-Za-z0-9_.]+)\/([^}\s]+)\}/.exec(raw);
    if (m) return { package: m[1], activity: m[2] };
    const m2 = /mFocusedApp=ActivityRecord\{[^\s]+\s+(?:u\d+\s+)?([A-Za-z0-9_.]+)\/([^}\s]+)/.exec(raw);
    if (m2) return { package: m2[1], activity: m2[2] };
  } catch {}
  return null;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function parseUiNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  for (const match of xml.matchAll(/<node\s+([^>]+?)\/?\s*>/g)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[1].matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attributes[attribute[1]] = decodeXml(attribute[2]);
    }
    const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(attributes.bounds ?? "");
    if (!bounds) continue;
    const text = attributes.text ?? "";
    const description = attributes["content-desc"] ?? "";
    const id = attributes["resource-id"] ?? "";
    const className = attributes.class ?? "";
    const clickable = attributes.clickable === "true";
    const focusable = attributes.focusable === "true";
    const focused = attributes.focused === "true";
    const scrollable = attributes.scrollable === "true";
    const editable = className.toLowerCase().includes("edittext") || attributes.password === "true";
    const pkg = attributes.package ?? "";

    if (!text && !description && !id && !clickable && !editable && !scrollable) continue;

    nodes.push({
      text,
      description,
      id,
      className,
      bounds: [Number(bounds[1]), Number(bounds[2]), Number(bounds[3]), Number(bounds[4])],
      clickable,
      focusable,
      focused,
      scrollable,
      editable,
      package: pkg,
    });
  }
  return nodes;
}

export async function readNodes(serial: string): Promise<UiNode[]> {
  const streamed = (await onDevice(serial, ["shell", "uiautomator", "dump", "/dev/tty"]).catch(() => Buffer.from(""))).toString("utf8");
  const streamedStart = streamed.indexOf("<?xml");
  if (streamedStart >= 0) return parseUiNodes(streamed.slice(streamedStart));

  const remotePath = "/data/local/tmp/openmaus-window.xml";
  await onDevice(serial, ["shell", "uiautomator", "dump", remotePath]);
  const saved = (await onDevice(serial, ["shell", "cat", remotePath])).toString("utf8");
  void onDevice(serial, ["shell", "rm", "-f", remotePath]).catch(() => undefined);
  const savedStart = saved.indexOf("<?xml");
  return parseUiNodes(savedStart >= 0 ? saved.slice(savedStart) : saved);
}

export function formatScreenState(state: ScreenState): string {
  const header = `Active Screen: ${state.currentPackage}${state.currentActivity ? ` / ${state.currentActivity}` : ""} (${state.nodes.length} visible elements)`;
  const lines = state.nodes.slice(0, 160).map((node, index) => {
    const label = [node.text, node.description].filter(Boolean).join(" · ");
    const tags = [
      node.clickable ? "[CLICKABLE]" : "",
      node.editable ? "[EDITABLE]" : "",
      node.focused ? "[FOCUSED]" : "",
      node.scrollable ? "[SCROLLABLE]" : "",
    ].filter(Boolean).join(" ");
    const tagSuffix = tags ? ` ${tags}` : "";
    return `${index}: ${JSON.stringify(label || node.id || node.className)} bounds=${node.bounds.join(",")}${tagSuffix}`;
  });
  return [header, ...lines].join("\n") || "No accessible UI elements visible on screen.";
}

// ── App Discovery & Management ──────────────────────────────────────────

export async function listAppCatalog(serial: string, query?: string): Promise<AppInfo[]> {
  const [actOutput, installed, enabled] = await Promise.all([
    onDevice(serial, [
      "shell", "cmd", "package", "query-activities", "--brief",
      "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER",
    ]).catch(() => Buffer.from("")),
    getInstalledPackages(serial),
    getEnabledPackages(serial),
  ]);
  const launchableMap = parseLaunchableActivities(actOutput.toString("utf8"));

  const results: AppInfo[] = [];
  for (const [pkg, act] of launchableMap.entries()) {
    results.push({
      name: humanLabelForPackage(pkg),
      packageName: pkg,
      activity: act,
      launchable: true,
      enabled: enabled.has(pkg),
    });
  }

  if (!query) return results;

  const needle = normalize(query);
  const filtered = results.filter((app) => (
    normalize(app.name).includes(needle) ||
    normalize(app.packageName).includes(needle)
  ));

  if (filtered.length > 0) return filtered;

  // Check if installed but non-launchable
  for (const pkg of installed) {
    if (normalize(pkg).includes(needle) || normalize(humanLabelForPackage(pkg)).includes(needle)) {
      if (!results.some((r) => r.packageName === pkg)) {
        results.push({
          name: humanLabelForPackage(pkg),
          packageName: pkg,
          launchable: false,
          enabled: enabled.has(pkg),
        });
      }
    }
  }

  return results.filter((app) => normalize(app.name).includes(needle) || normalize(app.packageName).includes(needle));
}

export async function openApp(
  serial: string,
  appName: string,
): Promise<string> {
  const cleaned = appName.trim();
  if (!cleaned) throw new PhoneActionError("ACTION_NOT_SUPPORTED", "name is required");

  const [actOutput, installed] = await Promise.all([
    onDevice(serial, [
      "shell", "cmd", "package", "query-activities", "--brief",
      "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER",
    ]).catch(() => Buffer.from("")),
    getInstalledPackages(serial),
  ]);
  const launchableMap = parseLaunchableActivities(actOutput.toString("utf8"));
  const launchablePkgs = Array.from(launchableMap.keys());
  const matches = findPackages(cleaned, launchablePkgs);

  if (matches.length === 0) {
    const installedMatches = findPackages(cleaned, Array.from(installed));
    if (installedMatches.length > 0) {
      throw new PhoneActionError(
        "APP_NOT_LAUNCHABLE",
        `${cleaned} is installed (${installedMatches[0]}), but has no launchable launcher activity.`
      );
    }
    throw new PhoneActionError(
      "APP_NOT_INSTALLED",
      `No installed launchable application matches "${cleaned}".`
    );
  }

  if (matches.length > 1) {
    throw new PhoneActionError(
      "ACTION_NOT_SUPPORTED",
      `App name is ambiguous: ${matches.map((p) => humanLabelForPackage(p)).join(", ")}`
    );
  }

  const targetPkg = matches[0];
  const human = humanLabelForPackage(targetPkg);
  const component = launchableMap.get(targetPkg);

  if (component) {
    await onDevice(serial, ["shell", "am", "start", "-n", escapeShellComponent(component)]);
  } else {
    await onDevice(serial, ["shell", "monkey", "-p", targetPkg, "-c", "android.intent.category.LAUNCHER", "1"]);
  }

  // Observe device & verify foreground package settles
  const start = Date.now();
  const timeoutMs = 7000;
  let settled = false;
  let fg: { package: string; activity: string } | null = null;
  while (Date.now() - start < timeoutMs) {
    fg = await getForegroundActivity(serial);
    if (fg && (fg.package === targetPkg || fg.package.startsWith(`${targetPkg}.`))) {
      settled = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  if (!settled) {
    throw new PhoneActionError(
      "VERIFICATION_FAILED",
      `${human} could not be opened: foreground did not switch to ${targetPkg} (currently ${fg?.package ?? "unknown"}).`,
      { expected: targetPkg, actual: fg?.package }
    );
  }

  return `${human} is open.`;
}

// ── Screen Actions ──────────────────────────────────────────────────────

export async function tapNode(
  serial: string,
  query: string,
  options: { exact?: boolean; index?: number } = {}
): Promise<string> {
  const needle = query.trim().toLowerCase();
  if (!needle) throw new PhoneActionError("ACTION_NOT_SUPPORTED", "text is required");
  const exact = options.exact === true;
  const nodes = await readNodes(serial);
  const hits = nodes.filter((node) => {
    const [x1, y1, x2, y2] = node.bounds;
    if (x2 <= x1 || y2 <= y1) return false;
    const labels = [node.text, node.description, node.id].filter(Boolean).map((v) => v.toLowerCase());
    return labels.some((label) => (exact ? label === needle : label.includes(needle)));
  });

  const index = Number.isInteger(options.index) ? Number(options.index) : 0;
  const hit = hits[index];
  if (!hit) {
    throw new PhoneActionError("TARGET_NOT_FOUND", `No visible Android text matches "${query}".`);
  }

  const [x1, y1, x2, y2] = hit.bounds;
  const cx = Math.round((x1 + x2) / 2);
  const cy = Math.round((y1 + y2) / 2);
  await onDevice(serial, ["shell", "input", "tap", String(cx), String(cy)]);
  await new Promise((r) => setTimeout(r, 350));
  return `Tapped "${hit.text || hit.description || hit.id}"`;
}

export async function tapCoordinates(serial: string, x: number, y: number): Promise<string> {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 10000 || y > 10000) {
    throw new PhoneActionError("ACTION_NOT_SUPPORTED", `Invalid coordinates: ${x}, ${y}`);
  }
  await onDevice(serial, ["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
  await new Promise((r) => setTimeout(r, 350));
  return `Tapped ${Math.round(x)},${Math.round(y)}`;
}

export async function typeText(serial: string, text: string): Promise<string> {
  const normalized = normalizeInputText(text);
  if (!normalized || normalized.length > 512 || !SAFE_TEXT.test(normalized)) {
    throw new PhoneActionError("ACTION_NOT_SUPPORTED", "Android text supports printable text up to 512 characters");
  }
  const lines = normalized.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 0) {
      const escaped = escapeInputText(line);
      await onDevice(serial, ["shell", "input", "text", escaped]);
    }
    if (i < lines.length - 1) {
      await onDevice(serial, ["shell", "input", "keyevent", "66"]);
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  return "Typed text into the focused Android field";
}

export async function clearText(serial: string): Promise<string> {
  await onDevice(serial, ["shell", "input", "keyevent", "123"]); // KEYCODE_MOVE_END
  const delArgs = ["shell", "input", "keyevent", ...Array(40).fill("KEYCODE_DEL")];
  await onDevice(serial, delArgs);
  await new Promise((r) => setTimeout(r, 200));
  return "Cleared focused text field";
}

export async function swipeScreen(serial: string, direction: string): Promise<string> {
  const norm = direction.toLowerCase();
  if (norm !== "up" && norm !== "down" && norm !== "left" && norm !== "right") {
    throw new PhoneActionError("ACTION_NOT_SUPPORTED", `Invalid swipe direction: ${direction}`);
  }
  const size = (await onDevice(serial, ["shell", "wm", "size"])).toString("utf8");
  const match = /(\d+)x(\d+)/.exec(size);
  if (!match) throw new PhoneActionError("ACTION_FAILED", "Could not read Android screen size");
  const width = Number(match[1]);
  const height = Number(match[2]);
  const points: Record<string, [number, number, number, number]> = {
    up: [width / 2, height * 0.75, width / 2, height * 0.25],
    down: [width / 2, height * 0.25, width / 2, height * 0.75],
    left: [width * 0.75, height / 2, width * 0.25, height / 2],
    right: [width * 0.25, height / 2, width * 0.75, height / 2],
  };
  const point = points[norm];
  await onDevice(serial, ["shell", "input", "swipe", ...point.map((v) => String(Math.round(v))), "300"]);
  await new Promise((r) => setTimeout(r, 350));
  return `Swiped ${direction}`;
}

export async function pressKey(serial: string, key: string): Promise<string> {
  const norm = key.toLowerCase();
  const code = KEYCODES[norm];
  if (!code) throw new PhoneActionError("ACTION_NOT_SUPPORTED", `Unsupported Android key: ${key}`);
  await onDevice(serial, ["shell", "input", "keyevent", code]);
  await new Promise((r) => setTimeout(r, 350));
  return `Pressed ${key}`;
}

// ── Turn Isolation & Concurrency ────────────────────────────────────────

const MAX_SEEN_ACTIONS = 1000;
export const seenActions = new Set<string>();
let activeDeviceLock: Promise<void> = Promise.resolve();

export function checkActionIsolation(args: Json) {
  const actionId = typeof args.actionId === "string" ? args.actionId : undefined;
  if (actionId) {
    if (seenActions.has(actionId)) {
      throw new PhoneActionError("ACTION_FAILED", `Action ${actionId} was already executed (duplicate rejected).`);
    }
    if (seenActions.size >= MAX_SEEN_ACTIONS) {
      const first = seenActions.values().next().value;
      if (first !== undefined) seenActions.delete(first);
    }
    seenActions.add(actionId);
  }
}

export function rollbackActionIsolation(args: Json) {
  const actionId = typeof args.actionId === "string" ? args.actionId : undefined;
  if (actionId) {
    seenActions.delete(actionId);
  }
}

export function resetActionIsolation() {
  seenActions.clear();
}

async function withDeviceLock<T>(fn: () => Promise<T>): Promise<T> {
  const prevLock = activeDeviceLock;
  let release: () => void = () => {};
  activeDeviceLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prevLock;
  try {
    return await fn();
  } finally {
    release();
  }
}

function verifyPermission(toolName: string) {
  const perms = loadDiskPermissions();
  const check = checkToolPermission(toolName, perms);
  if (!check.allowed) {
    throw new PhoneActionError("PERMISSION_DENIED", check.reason);
  }
}

// ── Tool Definitions ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "status",
    description: "Check physical USB Android devices and USB-debugging authorization before any Android phone task.",
    inputSchema: { type: "object", properties: { actionId: { type: "string" }, turnId: { type: "string" } } },
  },
  {
    name: "read_screen",
    description: "Read active foreground package and visible text, accessibility labels, resource ids, clickable/editable controls, and pixel bounds from the connected Android screen.",
    inputSchema: { type: "object", properties: { serial: { type: "string" }, actionId: { type: "string" }, turnId: { type: "string" } } },
  },
  {
    name: "screenshot",
    description: "Capture the connected Android screen when accessibility text is insufficient. Returns a PNG image.",
    inputSchema: { type: "object", properties: { serial: { type: "string" }, actionId: { type: "string" }, turnId: { type: "string" } } },
  },
  {
    name: "list_apps",
    description: "List installed and launchable Android applications with human-readable labels, distinguishing launchable from background services.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, serial: { type: "string" }, actionId: { type: "string" }, turnId: { type: "string" } } },
  },
  {
    name: "open_app",
    description: "Open an installed Android app directly by its human name (e.g. WhatsApp, Settings, Chrome, Maps). Waits for device foreground state to settle and verifies foreground package before reporting success.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, serial: { type: "string" }, actionId: { type: "string" }, turnId: { type: "string" } }, required: ["name"] },
  },
  {
    name: "tap_text",
    description: "Tap visible Android text or an accessibility label, then use read_screen to verify.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, exact: { type: "boolean" }, index: { type: "integer", minimum: 0 }, serial: { type: "string" }, actionId: { type: "string" }, turnId: { type: "string" } }, required: ["text"] },
  },
  {
    name: "tap",
    description: "Tap Android screen pixel coordinates obtained from read_screen or screenshot.",
    inputSchema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, serial: { type: "string" }, actionId: { type: "string" }, turnId: { type: "string" } }, required: ["x", "y"] },
  },
  {
    name: "type_text",
    description: "Type basic ASCII text into the focused Android field. Never enter passwords, payment details, or one-time codes.",
    inputSchema: { type: "object", properties: { text: { type: "string", maxLength: 256 }, serial: { type: "string" }, actionId: { type: "string" }, turnId: { type: "string" } }, required: ["text"] },
  },
  {
    name: "clear_text",
    description: "Clear basic text in the focused Android input field, then use read_screen to verify.",
    inputSchema: { type: "object", properties: { serial: { type: "string" }, actionId: { type: "string" }, turnId: { type: "string" } } },
  },
  {
    name: "swipe",
    description: "Swipe the Android screen in a direction, then use read_screen to verify.",
    inputSchema: { type: "object", properties: { direction: { type: "string", enum: ["up", "down", "left", "right"] }, serial: { type: "string" }, actionId: { type: "string" }, turnId: { type: "string" } }, required: ["direction"] },
  },
  {
    name: "press",
    description: "Press an Android navigation or keyboard key.",
    inputSchema: { type: "object", properties: { key: { type: "string", enum: Object.keys(KEYCODES) }, serial: { type: "string" }, actionId: { type: "string" }, turnId: { type: "string" } }, required: ["key"] },
  },
] as const;

type ToolResult = {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
};

const textResult = (text: string, isError = false): ToolResult => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError: true } : {}),
});

async function callTool(name: string, args: Json): Promise<ToolResult> {
  verifyPermission(name);
  checkActionIsolation(args);

  try {
    return await withDeviceLock(async () => {
    if (name === "status") {
      if (isNativeDriverActive()) {
        const data = await callNativeDriver("/status");
        return textResult(JSON.stringify({ available: true, native: true, ...data }, null, 2));
      }
      const adb = resolveAdbPath();
      const devices = adb ? await usbDevices() : [];
      return textResult(JSON.stringify({ available: Boolean(adb), devices }, null, 2));
    }

    const serial = await readySerial(args.serial);

    if (name === "read_screen") {
      if (isNativeDriverActive()) {
        const data = await callNativeDriver("/screen");
        if (!data.ok) throw new PhoneActionError(data.code || "ACTION_FAILED", data.error || "Failed to read screen");
        const state: ScreenState = {
          currentPackage: data.currentPackage || "unknown",
          currentActivity: data.currentActivity,
          nodeCount: data.nodeCount || 0,
          nodes: data.nodes || [],
        };
        return textResult(formatScreenState(state));
      }
      const [nodes, fg] = await Promise.all([
        readNodes(serial),
        getForegroundActivity(serial),
      ]);
      const state: ScreenState = {
        currentPackage: fg?.package ?? "unknown",
        currentActivity: fg?.activity,
        nodeCount: nodes.length,
        nodes,
      };
      return textResult(formatScreenState(state));
    }

    if (name === "screenshot") {
      if (isNativeDriverActive()) {
        const data = await callNativeDriver("/screenshot", { method: "POST", body: { includeBase64: true } });
        if (!data.ok) throw new PhoneActionError(data.code || "ACTION_FAILED", data.error || "Screenshot failed");
        return {
          content: [
            { type: "text", text: `Native Android screenshot from ${serial}` },
            { type: "image", data: data.base64, mimeType: "image/png" },
          ],
        };
      }
      const png = await onDevice(serial, ["exec-out", "screencap", "-p"], true);
      if (!png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
        throw new PhoneActionError("ACTION_FAILED", "Android returned an invalid screenshot");
      }
      return {
        content: [
          { type: "text", text: `Android screenshot from ${serial}` },
          { type: "image", data: png.toString("base64"), mimeType: "image/png" },
        ],
      };
    }

    if (name === "list_apps") {
      const query = typeof args.query === "string" ? args.query : undefined;
      const apps = await listAppCatalog(serial, query);
      if (apps.length === 0) {
        return textResult(query ? `No matching installed apps found for "${query}".` : "No installed apps found.");
      }
      const formatted = apps.map((app) => (
        `${app.name} (${app.packageName}) [${app.launchable ? "LAUNCHABLE" : "BACKGROUND"} / ${app.enabled ? "ENABLED" : "DISABLED"}]`
      )).join("\n");
      return textResult(formatted);
    }

    if (name === "open_app") {
      const appName = String(args.name ?? "");
      if (isNativeDriverActive()) {
        const cleaned = appName.trim();
        const [actOutput, installed] = await Promise.all([
          onDevice(serial, [
            "shell", "cmd", "package", "query-activities", "--brief",
            "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER",
          ]).catch(() => Buffer.from("")),
          getInstalledPackages(serial),
        ]);
        const launchableMap = parseLaunchableActivities(actOutput.toString("utf8"));
        const matches = findPackages(cleaned, Array.from(launchableMap.keys()));
        const targetPkg = matches.length === 1 ? matches[0] : (findPackages(cleaned, Array.from(installed))[0] || cleaned);
        const data = await callNativeDriver("/open_app", { method: "POST", body: { packageName: targetPkg } });
        if (!data.ok) throw new PhoneActionError(data.code || "ACTION_FAILED", data.error || `Could not open ${appName}`);
        return textResult(`${humanLabelForPackage(targetPkg)} is open.`);
      }
      const res = await openApp(serial, appName);
      return textResult(res);
    }

    if (name === "tap_text") {
      const text = String(args.text ?? "");
      const exact = args.exact === true;
      const index = typeof args.index === "number" ? args.index : undefined;
      if (isNativeDriverActive()) {
        const data = await callNativeDriver("/tap", { method: "POST", body: { text, exact } });
        if (!data.ok) throw new PhoneActionError(data.code || "TARGET_NOT_FOUND", data.error || `No visible Android text matches "${text}"`);
        return textResult(`Tapped "${text}"`);
      }
      const res = await tapNode(serial, text, { exact, index });
      return textResult(res);
    }

    if (name === "tap") {
      const x = Number(args.x);
      const y = Number(args.y);
      if (isNativeDriverActive()) {
        const data = await callNativeDriver("/tap", { method: "POST", body: { x, y } });
        if (!data.ok) throw new PhoneActionError(data.code || "ACTION_FAILED", data.error || "Tap failed");
        return textResult(`Tapped ${x},${y}`);
      }
      const res = await tapCoordinates(serial, x, y);
      return textResult(res);
    }

    if (name === "type_text") {
      const text = String(args.text ?? "");
      if (isNativeDriverActive()) {
        const data = await callNativeDriver("/type", { method: "POST", body: { text } });
        if (!data.ok) throw new PhoneActionError(data.code || "ACTION_FAILED", data.error || "Type text failed");
        return textResult("Typed text into the focused Android field");
      }
      const res = await typeText(serial, text);
      return textResult(res);
    }

    if (name === "clear_text") {
      const res = await clearText(serial);
      return textResult(res);
    }

    if (name === "swipe") {
      const direction = String(args.direction ?? "");
      if (isNativeDriverActive()) {
        const data = await callNativeDriver("/scroll", { method: "POST", body: { direction } });
        if (!data.ok) throw new PhoneActionError(data.code || "ACTION_FAILED", data.error || "Swipe failed");
        return textResult(`Swiped ${direction}`);
      }
      const res = await swipeScreen(serial, direction);
      return textResult(res);
    }

    if (name === "press") {
      const key = String(args.key ?? "");
      if (isNativeDriverActive()) {
        const data = await callNativeDriver("/key", { method: "POST", body: { key } });
        if (!data.ok) throw new PhoneActionError(data.code || "ACTION_FAILED", data.error || "Press key failed");
        return textResult(`Pressed ${key}`);
      }
      const res = await pressKey(serial, key);
      return textResult(res);
    }

    throw new PhoneActionError("ACTION_NOT_SUPPORTED", `Unknown phone tool: ${name}`);
    });
  } catch (error) {
    rollbackActionIsolation(args);
    throw error;
  }
}

const send = (message: Json) => process.stdout.write(`${JSON.stringify(message)}\n`);
const ok = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(message: Json) {
  const id = message.id;
  const method = message.method;
  const params = (message.params ?? {}) as Json;
  if (method === "initialize") {
    return ok(id, {
      protocolVersion: String(params.protocolVersion ?? "2024-11-05"),
      capabilities: { tools: {} },
      serverInfo: { name: "openmausbot-phone", version: "2.0.0" },
    });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = String(params.name ?? "");
    if (!TOOLS.some((tool) => tool.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
    try {
      const res = await callTool(name, (params.arguments ?? {}) as Json);
      return ok(id, res);
    } catch (error) {
      if (error instanceof PhoneActionError) {
        return ok(id, textResult(`[${error.code}] ${error.message}`, true));
      }
      return ok(id, textResult(error instanceof Error ? error.message : String(error), true));
    }
  }
  if (id !== undefined) rpcError(id, -32601, `Method not found: ${String(method)}`);
}

if (process.argv[1] && existsSync(process.argv[1]) && /phone-proxy\.(?:ts|js)$/.test(process.argv[1])) {
  const lines = createInterface({ input: process.stdin, terminal: false });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line) as Json;
      void handle(message).catch((error) => rpcError(message.id, -32603, error instanceof Error ? error.message : String(error)));
    } catch {}
  });
}
