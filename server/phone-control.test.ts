import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createServer, Server } from "node:http";
import { defaultCapabilityRegistry } from "./capabilities/capability-registry.ts";
import { PhoneControlCapability } from "./capabilities/phone-control.ts";
import { checkLivePhoneControlAvailability, setMockPhoneDriverStatus } from "./capabilities/action-truthfulness.ts";
import {
  isNativeDriverActive,
  readySerial,
} from "./drivers/phone-proxy.ts";

describe("Native Android Phone Control (Phase 35 Foundation)", () => {
  let mockServer: Server | null = null;
  let mockPort: number = 0;
  const mockToken = "test-capability-token-32bytes-secret";
  let lastReceivedRequest: { method: string; url: string; headers: any; body?: any } | null = null;
  let mockAccessibilityReady = true;

  beforeEach(async () => {
    setMockPhoneDriverStatus(null);
    lastReceivedRequest = null;
    mockAccessibilityReady = true;

    // Spin up ephemeral loopback HTTP server simulating in-app PhoneDriverServer
    mockServer = createServer((req, res) => {
      const auth = req.headers["authorization"];
      if (auth !== `Bearer ${mockToken}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized: bad capability token" }));
        return;
      }

      let rawBody = "";
      req.on("data", (chunk) => {
        rawBody += chunk;
      });
      req.on("end", () => {
        let body: any = null;
        if (rawBody) {
          try {
            body = JSON.parse(rawBody);
          } catch {}
        }
        lastReceivedRequest = {
          method: req.method || "GET",
          url: req.url || "/",
          headers: req.headers,
          body,
        };

        const uri = req.url?.split("?")[0];
        if (req.method === "GET" && uri === "/status") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              connected: mockAccessibilityReady,
              accessibilityEnabled: mockAccessibilityReady,
              foregroundPackage: "com.whatsapp",
              reason: mockAccessibilityReady
                ? "Native AccessibilityService is active and connected"
                : "AccessibilityService not enabled in Android Settings",
            })
          );
        } else if (req.method === "GET" && uri === "/screen") {
          if (!mockAccessibilityReady) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                ok: false,
                code: "ACCESSIBILITY_DISABLED",
                error: "ERR_ACCESSIBILITY_DISABLED: Accessibility service is not enabled in Android Settings.",
              })
            );
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              currentPackage: "com.whatsapp",
              nodeCount: 2,
              nodes: [
                {
                  text: "Chats",
                  description: "Chats tab",
                  id: "com.whatsapp:id/tab_chats",
                  className: "android.widget.TextView",
                  bounds: [0, 100, 300, 180],
                  clickable: true,
                  focusable: true,
                  focused: false,
                  scrollable: false,
                  editable: false,
                  package: "com.whatsapp",
                },
                {
                  text: "Search",
                  description: "Search chats",
                  id: "com.whatsapp:id/search_box",
                  className: "android.widget.EditText",
                  bounds: [310, 100, 1000, 180],
                  clickable: true,
                  focusable: true,
                  focused: true,
                  scrollable: false,
                  editable: true,
                  package: "com.whatsapp",
                },
              ],
            })
          );
        } else if (req.method === "POST" && uri === "/tap") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, message: `Tapped ${body?.text || body?.x}` }));
        } else if (req.method === "POST" && uri === "/type") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, message: "Typed text into active input field" }));
        } else if (req.method === "POST" && uri === "/scroll") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, message: `Scrolled screen ${body?.direction}` }));
        } else if (req.method === "POST" && uri === "/key") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, message: `Global action '${body?.key}' executed` }));
        } else if (req.method === "POST" && uri === "/open_app") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              launched: true,
              packageName: body?.packageName,
              settled: true,
              foregroundPackage: body?.packageName,
            })
          );
        } else if (req.method === "POST" && uri === "/screenshot") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              path: "/data/data/com.openmausbot.companion.preview/cache/screenshots/screen_1.png",
              width: 1080,
              height: 2400,
              base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            })
          );
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Not Found" }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      mockServer!.listen(0, "127.0.0.1", () => {
        const addr = mockServer!.address();
        if (typeof addr === "object" && addr) {
          mockPort = addr.port;
        }
        resolve();
      });
    });

    process.env.PH_DRIVER_PORT = String(mockPort);
    process.env.PH_DRIVER_TOKEN = mockToken;
  });

  afterEach(async () => {
    delete process.env.PH_DRIVER_PORT;
    delete process.env.PH_DRIVER_TOKEN;
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
      mockServer = null;
    }
  });

  it("registers PhoneControlCapability in defaultCapabilityRegistry under 'device.phone_control'", () => {
    const cap = defaultCapabilityRegistry.get("device.phone_control");
    expect(cap).toBeDefined();
    expect(cap?.name).toBe("Phone Control & Automation");
    expect(cap?.riskClassification).toBe("medium");
    expect(cap?.supportedOperations.map((op) => op.name)).toContain("status");
    expect(cap?.supportedOperations.map((op) => op.name)).toContain("read_screen");
    expect(cap?.supportedOperations.map((op) => op.name)).toContain("tap");
    expect(cap?.supportedOperations.map((op) => op.name)).toContain("type_text");
    expect(cap?.supportedOperations.map((op) => op.name)).toContain("scroll");
    expect(cap?.supportedOperations.map((op) => op.name)).toContain("press_key");
    expect(cap?.supportedOperations.map((op) => op.name)).toContain("open_app");
    expect(cap?.supportedOperations.map((op) => op.name)).toContain("take_screenshot");
  });

  it("detects native loopback driver and marks availability operational", () => {
    expect(isNativeDriverActive()).toBe(true);
    const status = checkLivePhoneControlAvailability();
    expect(status.operational).toBe(true);
    expect(status.driverPort).toBe(String(mockPort));
    expect(status.reason).toContain("Native Android Phone Driver");
    expect(status.supportedActions).toContain("read_screen");
  });

  it("readySerial returns 'native-android' without requiring an ADB device or USB connection", async () => {
    const serial = await readySerial();
    expect(serial).toBe("native-android");
  });

  it("queries /status through PhoneControlCapability and reports live foreground package", async () => {
    const cap = new PhoneControlCapability();
    const res = await cap.execute("status", {});
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({
      operational: true,
      accessibilityEnabled: true,
      foregroundPackage: "com.whatsapp",
      mode: "native_loopback",
    });
    expect(lastReceivedRequest?.url).toBe("/status");
    expect(lastReceivedRequest?.headers["authorization"]).toBe(`Bearer ${mockToken}`);
  });

  it("reads semantic screen nodes via native driver /screen endpoint without ADB", async () => {
    const cap = new PhoneControlCapability();
    const res = await cap.execute("read_screen", {});
    expect(res.success).toBe(true);
    expect((res.data as any).currentPackage).toBe("com.whatsapp");
    expect((res.data as any).nodeCount).toBe(2);
    expect((res.data as any).nodes[0]).toMatchObject({
      text: "Chats",
      id: "com.whatsapp:id/tab_chats",
      clickable: true,
    });
    expect(lastReceivedRequest?.url).toBe("/screen");
  });

  it("fails closed when AccessibilityService is disabled in Android Settings", async () => {
    mockAccessibilityReady = false;
    const cap = new PhoneControlCapability();
    const res = await cap.execute("read_screen", {});
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("ACCESSIBILITY_DISABLED");
    expect(res.error?.message).toContain("Accessibility service is not enabled");
  });

  it("dispatches tap action with text parameter and receives confirmation", async () => {
    const cap = new PhoneControlCapability();
    const res = await cap.execute("tap", { text: "Chats", exact: true });
    expect(res.success).toBe(true);
    expect((res.data as any).tapped).toBe(true);
    expect(lastReceivedRequest?.url).toBe("/tap");
    expect(lastReceivedRequest?.body).toMatchObject({ text: "Chats", exact: true });
  });

  it("dispatches coordinate tap with x and y coordinates", async () => {
    const cap = new PhoneControlCapability();
    const res = await cap.execute("tap", { x: 500, y: 350 });
    expect(res.success).toBe(true);
    expect(lastReceivedRequest?.url).toBe("/tap");
    expect(lastReceivedRequest?.body).toMatchObject({ x: 500, y: 350 });
  });

  it("dispatches text input via type_text", async () => {
    const cap = new PhoneControlCapability();
    const res = await cap.execute("type_text", { text: "Hello from MOBOT" });
    expect(res.success).toBe(true);
    expect((res.data as any).typed).toBe(true);
    expect(lastReceivedRequest?.url).toBe("/type");
    expect(lastReceivedRequest?.body).toMatchObject({ text: "Hello from MOBOT" });
  });

  it("dispatches scroll action with specified direction", async () => {
    const cap = new PhoneControlCapability();
    const res = await cap.execute("scroll", { direction: "down" });
    expect(res.success).toBe(true);
    expect((res.data as any).scrolled).toBe(true);
    expect(lastReceivedRequest?.url).toBe("/scroll");
    expect(lastReceivedRequest?.body).toMatchObject({ direction: "down" });
  });

  it("dispatches global navigation key (back, home, recents)", async () => {
    const cap = new PhoneControlCapability();
    const res = await cap.execute("press_key", { key: "back" });
    expect(res.success).toBe(true);
    expect((res.data as any).pressed).toBe(true);
    expect(lastReceivedRequest?.url).toBe("/key");
    expect(lastReceivedRequest?.body).toMatchObject({ key: "back" });
  });

  it("launches an application via open_app without shell am start", async () => {
    const cap = new PhoneControlCapability();
    const res = await cap.execute("open_app", { packageName: "com.whatsapp" });
    expect(res.success).toBe(true);
    expect((res.data as any).launched).toBe(true);
    expect((res.data as any).packageName).toBe("com.whatsapp");
    expect(lastReceivedRequest?.url).toBe("/open_app");
    expect(lastReceivedRequest?.body).toMatchObject({ packageName: "com.whatsapp" });
  });

  it("captures native screenshot without ADB", async () => {
    const cap = new PhoneControlCapability();
    const res = await cap.execute("take_screenshot", { includeBase64: true });
    expect(res.success).toBe(true);
    expect((res.data as any).width).toBe(1080);
    expect((res.data as any).height).toBe(2400);
    expect((res.data as any).base64).toBeDefined();
    expect(lastReceivedRequest?.url).toBe("/screenshot");
  });

  it("rejects unauthorized calls when capability token is invalid", async () => {
    process.env.PH_DRIVER_TOKEN = "wrong-token";
    const cap = new PhoneControlCapability();
    const res = await cap.execute("read_screen", {});
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("DRIVER_ERROR");
    expect(res.error?.message).toContain("HTTP 401");
  });
});
