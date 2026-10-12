import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";
import { ROOM_EXCHANGE_PROMPT } from "./system-prompt.ts";

// Two members asked to debate must keep answering each other: a reply's
// @mention gives the named member a turn, and a member who already spoke CAN
// be summoned again into a deeper hop — Ana → Bo → Ana → Bo → Ana, with no
// further input from the person. The depth cap (MAX_GROUP_HOPS) and the
// per-depth dedup still bound the round, and the dispatched prompts carry the
// room-exchange note that tells members this is possible.

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");

let child: ChildProcess;
let home = "";
let base = "";
let stderr = "";

type StateMessage = {
  id: string;
  kind: string;
  role?: string;
  text?: string;
  from?: { botId?: string; name?: string };
};

const api = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

const fixture = (displayName: string, environment: Record<string, string>) => ({
  driver: "claudeAgent",
  displayName,
  environment,
  config: { cli: FAKE_CLAUDE },
});

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-room-debate-"));
  const data = join(home, ".openmausbot");
  const staticDir = join(home, "static");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Room debate test</title>");
  writeFileSync(join(staticDir, "assets", "smoke.css"), "body{}");
  const anaPrompts = join(home, "ana-prompts.jsonl");
  const boPrompts = join(home, "bo-prompts.jsonl");
  const anaState = join(home, "ana-replies.txt");
  const boState = join(home, "bo-replies.txt");
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: {
      ana: fixture("Ana", {
        FAKE_CLAUDE_REPLIES: JSON.stringify([
          "@Bo your opening statement, please.",
          "@Bo one more consideration from my side.",
          "Concluded — the debate has served its purpose.",
        ]),
        FAKE_CLAUDE_REPLY_STATE: anaState,
        FAKE_CLAUDE_PROMPTS: anaPrompts,
      }),
      bo: fixture("Bo", {
        FAKE_CLAUDE_REPLIES: JSON.stringify([
          "@Ana here is my counterpoint.",
          "@Ana final rebuttal.",
        ]),
        FAKE_CLAUDE_REPLY_STATE: boState,
        FAKE_CLAUDE_PROMPTS: boPrompts,
      }),
    },
  }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      OMB_PORT: String(port),
      OMB_WEBHOOK_PORT: String(port + 1),
      OMB_STATIC_DIR: staticDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (chunk) => (stderr += chunk));

  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    try {
      if ((await fetch(`${base}/api/health`)).status === 200) break;
    } catch {
      // Still starting.
    }
    if (Date.now() >= deadline) throw new Error(`server never became healthy: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 30_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

const createBot = async (name: string, instanceId: string) =>
  (await api("POST", "/api/bots", {
    name,
    modelSelection: { instanceId, model: "claude-sonnet-5" },
    requireAvailableModel: true,
  })).body.bot;

const roomMessages = async (groupId: string): Promise<StateMessage[]> =>
  (await api("GET", "/api/bots?messages=40")).body.groups.find(
    (group: { id: string }) => group.id === groupId,
  )?.messages ?? [];

const speakersOf = (messages: StateMessage[]) =>
  messages
    .filter((message) => message.kind === "text" && message.role === "bot")
    .map((message) => message.from?.name)
    .filter((name, index, names) => index === 0 || name !== names[index - 1]);

const cleanup = async (roomId: string | undefined, botIds: string[]) => {
  if (roomId) await api("POST", `/api/groups/${roomId}/interrupt`, {}).catch(() => undefined);
  for (const botId of botIds) await api("POST", `/api/bots/${botId}/interrupt`, {}).catch(() => undefined);
  if (roomId) await api("DELETE", `/api/groups/${roomId}`).catch(() => undefined);
  for (const botId of botIds) await api("DELETE", `/api/bots/${botId}`).catch(() => undefined);
};

describe("a room debate continues without the person prompting each reply", { timeout: 60_000 }, () => {
  it("alternates two members across chained @mentions until one stops mentioning", async () => {
    const anaPrompts = join(home, "ana-prompts.jsonl");
    const boPrompts = join(home, "bo-prompts.jsonl");
    const ana = await createBot("Ana", "ana");
    const bo = await createBot("Bo", "bo");

    const room = (await api("POST", "/api/groups", {
      name: "Debate room",
      memberIds: [ana.id, bo.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: ana.id } },
    })).body.group;

    try {
      expect((await api("POST", `/api/groups/${room.id}/messages`, {
        text: "Debate the merits of covered bridges with each other.",
      })).status).toBe(202);

      // Ana → Bo → Ana → Bo → Ana: every hop is a reply mentioning the other
      // member, until Ana's final reply mentions nobody and the round ends.
      await expect.poll(async () => {
        const messages = await roomMessages(room.id);
        const working = (await api("GET", "/api/bots?messages=0")).body.groups.find(
          (group: { id: string }) => group.id === room.id,
        )?.working;
        return { working, speakers: speakersOf(messages), texts: messages.filter((m) => m.kind === "text" && m.role === "bot").length };
      }, { timeout: 30_000 }).toEqual({
        working: false,
        speakers: ["Ana", "Bo", "Ana", "Bo", "Ana"],
        texts: 5,
      });

      // The room-exchange note reached both members' prompts — the models
      // were told the exchange is possible before their first reply.
      for (const prompts of [anaPrompts, boPrompts]) {
        const promptsText = readFileSync(prompts, "utf8");
        expect(promptsText).toContain("Room exchange:");
        expect(promptsText).toContain("@mention a member of this room");
      }
      expect(ROOM_EXCHANGE_PROMPT).toContain("@mention a member of this room");
    } finally {
      await cleanup(room?.id, [ana.id, bo.id]);
    }
  });
});
