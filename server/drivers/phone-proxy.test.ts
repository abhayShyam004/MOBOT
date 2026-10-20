import { describe, expect, it } from "vitest";

import {
  checkActionIsolation,
  escapeInputText,
  escapeShellComponent,
  findPackages,
  formatScreenState,
  humanLabelForPackage,
  normalizeInputText,
  parseDevices,
  parseLaunchableActivities,
  parseLaunchablePackages,
  parseUiNodes,
  PhoneActionError,
  resetActionIsolation,
  rollbackActionIsolation,
  seenActions,
  type ScreenState,
  type UiNode,
} from "./phone-proxy.ts";

describe("phone MCP parsing & app discovery", () => {
  it("keeps physical USB devices distinguishable from network and emulator transports", () => {
    expect(parseDevices(`List of devices attached
USB123 device product:husky model:Pixel_8 usb:1-2 transport_id:4
emulator-5554 device product:sdk model:Emulator transport_id:6
192.0.2.4:5555 device product:remote model:Remote transport_id:7
`)).toEqual([
      { serial: "USB123", state: "device", connection: "usb", model: "Pixel 8" },
      { serial: "emulator-5554", state: "device", connection: "emulator", model: "Emulator" },
      { serial: "192.0.2.4:5555", state: "device", connection: "network", model: "Remote" },
    ]);
  });

  it("extracts unique launchable packages and components", () => {
    const raw = `3 activities found:
      com.ubercab/.presidio.RootActivity
      net.skyscanner.android.main/net.skyscanner.shell.SplashActivity
      com.ubercab/.presidio.RootActivity
    `;
    expect(parseLaunchablePackages(raw)).toEqual(["com.ubercab", "net.skyscanner.android.main"]);

    const actMap = parseLaunchableActivities(raw);
    expect(actMap.get("com.ubercab")).toBe("com.ubercab/.presidio.RootActivity");
    expect(actMap.get("net.skyscanner.android.main")).toBe("net.skyscanner.android.main/net.skyscanner.shell.SplashActivity");
  });

  it("resolves common human app names and provides canonical labels", () => {
    const packages = [
      "com.whatsapp",
      "com.android.settings",
      "com.android.chrome",
      "com.google.android.apps.maps",
      "com.ubercab",
      "net.skyscanner.android.main",
      "com.openmausbot.companion",
      "com.example.other",
    ];

    expect(findPackages("WhatsApp", packages)).toEqual(["com.whatsapp"]);
    expect(findPackages("Settings", packages)).toEqual(["com.android.settings"]);
    expect(findPackages("Chrome", packages)).toEqual(["com.android.chrome"]);
    expect(findPackages("Maps", packages)).toEqual(["com.google.android.apps.maps"]);
    expect(findPackages("Uber", packages)).toEqual(["com.ubercab"]);
    expect(findPackages("Skyscanner", packages)).toEqual(["net.skyscanner.android.main"]);
    expect(findPackages("MOBOT Companion", packages)).toEqual(["com.openmausbot.companion"]);
    expect(findPackages("OpenMausBot", packages)).toEqual(["com.openmausbot.companion"]);
    expect(findPackages("MOBOT", packages)).toEqual(["com.openmausbot.companion"]);

    expect(humanLabelForPackage("com.whatsapp")).toBe("WhatsApp");
    expect(humanLabelForPackage("com.android.settings")).toBe("Settings");
    expect(humanLabelForPackage("com.android.chrome")).toBe("Chrome");
    expect(humanLabelForPackage("com.google.android.apps.maps")).toBe("Google Maps");
  });

  it("turns Android UI XML into tap-ready visible nodes with semantic metadata", () => {
    const xml = `<?xml version="1.0"?>
<hierarchy>
  <node text="Where to?" resource-id="com.ubercab:id/input" class="android.widget.EditText" content-desc="Destination" bounds="[12,100][400,180]" clickable="true" focusable="true" focused="true" scrollable="false" package="com.ubercab" />
  <node text="Search" resource-id="com.ubercab:id/btn" class="android.widget.Button" content-desc="" bounds="[410,100][500,180]" clickable="true" focusable="false" focused="false" scrollable="false" package="com.ubercab" />
</hierarchy>`;

    const nodes = parseUiNodes(xml);
    expect(nodes).toHaveLength(2);

    expect(nodes[0]).toMatchObject({
      text: "Where to?",
      description: "Destination",
      id: "com.ubercab:id/input",
      className: "android.widget.EditText",
      bounds: [12, 100, 400, 180],
      clickable: true,
      focusable: true,
      focused: true,
      scrollable: false,
      editable: true,
      package: "com.ubercab",
    });

    expect(nodes[1]).toMatchObject({
      text: "Search",
      className: "android.widget.Button",
      bounds: [410, 100, 500, 180],
      clickable: true,
      editable: false,
    });
  });

  it("formats screen state with active package, count, and tags", () => {
    const nodes: UiNode[] = [
      {
        text: "Search Settings",
        description: "",
        id: "com.android.settings:id/search_action_bar",
        className: "android.widget.TextView",
        bounds: [24, 80, 696, 140],
        clickable: true,
        focusable: true,
        focused: false,
        scrollable: false,
        editable: false,
        package: "com.android.settings",
      },
    ];

    const state: ScreenState = {
      currentPackage: "com.android.settings",
      currentActivity: ".Settings",
      nodeCount: 1,
      nodes,
    };

    const formatted = formatScreenState(state);
    expect(formatted).toContain("Active Screen: com.android.settings / .Settings (1 visible elements)");
    expect(formatted).toContain('0: "Search Settings" bounds=24,80,696,140 [CLICKABLE]');
  });

  it("structures failure classifications properly", () => {
    const err1 = new PhoneActionError("APP_NOT_INSTALLED", "App not installed");
    expect(err1.code).toBe("APP_NOT_INSTALLED");

    const err2 = new PhoneActionError("APP_NOT_LAUNCHABLE", "App not launchable");
    expect(err2.code).toBe("APP_NOT_LAUNCHABLE");

    const err3 = new PhoneActionError("ANDROID_ACCESS_REQUIRED", "Access required");
    expect(err3.code).toBe("ANDROID_ACCESS_REQUIRED");

    const err4 = new PhoneActionError("TARGET_NOT_FOUND", "Target not found");
    expect(err4.code).toBe("TARGET_NOT_FOUND");

    const err5 = new PhoneActionError("VERIFICATION_FAILED", "Foreground verification failed");
    expect(err5.code).toBe("VERIFICATION_FAILED");

    const err6 = new PhoneActionError("PERMISSION_DENIED", "Permission denied");
    expect(err6.code).toBe("PERMISSION_DENIED");
  });

  it("escapes activity components containing dollar signs for Android shell execution", () => {
    expect(
      escapeShellComponent("com.google.android.youtube/.app.honeycomb.Shell$HomeActivity")
    ).toBe("com.google.android.youtube/.app.honeycomb.Shell\\$HomeActivity");

    expect(
      escapeShellComponent("com.example.app/com.example.app.ui.Main$SubActivity")
    ).toBe("com.example.app/com.example.app.ui.Main\\$SubActivity");

    expect(escapeShellComponent("com.android.settings/.Settings")).toBe(
      "com.android.settings/.Settings"
    );
  });

  it("escapes text input metacharacters and spaces for safe Android input text invocation", () => {
    expect(escapeInputText("hello world")).toBe("hello%sworld");
    expect(escapeInputText("don't")).toBe("don\\'t");
    expect(escapeInputText("hello;world")).toBe("hello\\;world");
    expect(escapeInputText("(test)")).toBe("\\(test\\)");
    expect(escapeInputText("Alert! Are you sure?")).toBe("Alert\\!%sAre%syou%ssure\\?");
    expect(escapeInputText('quotes: "hello"')).toBe('quotes:%s\\"hello\\"');
    expect(escapeInputText("tag & label")).toBe("tag%s\\&%slabel");
    expect(escapeInputText("a/b-c_d.e@f+g:h")).toBe("a/b-c_d.e@f+g:h");
    expect(escapeInputText("https://site.com?q=1&b=2#sec")).toBe("https://site.com\\?q=1\\&b=2\\#sec");
    expect(escapeInputText("x = {a: [1, 2]};")).toBe("x%s=%s\\{a:%s\\[1,%s2\\]\\}\\;");
  });

  it("normalizes smart quotes, em-dashes, and diacritics into ASCII for safe typing", () => {
    expect(normalizeInputText('“Smart quotes” and ‘single’')).toBe('"Smart quotes" and \'single\'');
    expect(normalizeInputText("Café résumé and naïve")).toBe("Cafe resume and naive");
    expect(normalizeInputText("Option A — Option B – Option C…")).toBe("Option A - Option B - Option C...");
  });

  it("isolates actionIds, rejects duplicate executions, allows retry on rollback, and bounds cache size", () => {
    resetActionIsolation();

    // First execution succeeds
    expect(() => checkActionIsolation({ actionId: "action-123" })).not.toThrow();
    expect(seenActions.has("action-123")).toBe(true);

    // Duplicate execution is rejected
    expect(() => checkActionIsolation({ actionId: "action-123" })).toThrow(
      /Action action-123 was already executed/
    );

    // Rollback removes actionId, permitting retry
    rollbackActionIsolation({ actionId: "action-123" });
    expect(seenActions.has("action-123")).toBe(false);
    expect(() => checkActionIsolation({ actionId: "action-123" })).not.toThrow();

    // Bounded size: add 1050 unique actions
    for (let i = 0; i < 1050; i++) {
      checkActionIsolation({ actionId: `bulk-action-${i}` });
    }
    expect(seenActions.size).toBe(1000);

    resetActionIsolation();
  });
});
