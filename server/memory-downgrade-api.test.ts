// The legacy-adoption downgrade, driven through the real HTTP API.
//
// The attack measured on the Galaxy A07: delete the integrity manifest and the
// legacy ledger (both live in directories the app UID can write), drop a record
// from records.json, and ask the API for memory. Before the fix the store
// looked like a first install that had never been sealed, so it was adopted and
// re-sealed with a live MAC — HTTP 200 with a reduced, attacker-chosen set.
//
// The harness now tells the host, on every spawn, whether this boot may adopt an
// unsealed store. This fixture runs the same server with that flag explicitly
// denied, which is the Android boot's answer, and asserts the request fails.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

interface Reply {
  status: number;
  // SAFETY: test-only view of JSON bodies; every field read below is asserted first
  body: any;
}

describe("canonical memory refuses a legacy-adoption downgrade over HTTP", () => {
  let fixture: VerificationServer;
  let botId = "";

  const api = async (method: string, path: string, body?: unknown): Promise<Reply> => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };

  const memoryDir = () => join(fixture.info.dataDir, "workspaces", botId, "memory");
  const recordsJson = () => join(memoryDir(), "records.json");
  const manifestJson = () => join(memoryDir(), "records.integrity.json");
  // HOME is the fixture data dir, and the ledger sits beside the retired key.
  const legacyDir = () => join(fixture.info.dataDir, ".openmausbot", "memory-integrity", "legacy");

  beforeAll(async () => {
    fixture = await launchVerificationServer({
      ...process.env,
      // The Android harness's answer on a boot that does not hold the retired
      // key. Explicit, so it also holds on the file provider this fixture uses.
      OMB_MEMORY_INTEGRITY_ALLOW_LEGACY_UPGRADE: "0",
    });
    const catalog = (await api("GET", "/api/instances")).body.instances;
    const instance = catalog.find((entry: { models?: { options?: unknown[] } }) => entry.models?.options?.length);
    const created = await api("POST", "/api/bots", {
      name: "Scout",
      modelSelection: { instanceId: instance.instanceId, model: instance.models.options[0].id },
    });
    expect(created.status).toBe(201);
    botId = created.body.bot.id;
  });

  afterAll(async () => {
    await fixture?.close();
  });

  it("serves authorized memory, then refuses the reduced store the attack produces", async () => {
    const note = (detail: string) => ({
      category: "episodic_event",
      headline: detail.split(".")[0],
      detail,
      confidence: 0.9,
      sourceTurnId: "downgrade-fixture",
    });

    expect((await api("POST", `/api/bots/${botId}/memory/records`, note("A note that must survive."))).status).toBe(200);
    expect((await api("POST", `/api/bots/${botId}/memory/records`, note("A note the attacker wants erased."))).status).toBe(200);

    const before = await api("GET", `/api/bots/${botId}/memory/records`);
    expect(before.status).toBe(200);
    expect(before.body.count).toBe(2);
    expect(existsSync(manifestJson())).toBe(true);

    // The attack: both integrity markers gone, one record dropped.
    rmSync(manifestJson(), { force: true });
    if (existsSync(legacyDir())) {
      for (const file of readdirSync(legacyDir())) rmSync(join(legacyDir(), file), { force: true });
    }
    const records = JSON.parse(readFileSync(recordsJson(), "utf8")) as unknown[];
    writeFileSync(recordsJson(), JSON.stringify(records.slice(0, 1), null, 2));

    const after = await api("GET", `/api/bots/${botId}/memory/records`);
    expect(after.status).toBe(500);
    expect(after.body.error).toMatch(/integrity|not authorized to adopt an unsealed store/i);

    // Writing over the same manifest-less store must not bless it either: a
    // save would otherwise mint a manifest for exactly the forged contents.
    const write = await api("POST", `/api/bots/${botId}/memory/records`, note("Repair attempt."));
    expect(write.status).toBe(500);
    expect(write.body.error).toMatch(/integrity|not authorized to adopt an unsealed store/i);

    // Nothing was re-sealed as a side effect of the refusals.
    expect(existsSync(manifestJson())).toBe(false);
    // And the record the attacker removed is still gone: the fix refuses to
    // trust the store, it does not silently restore it.
    expect((JSON.parse(readFileSync(recordsJson(), "utf8")) as unknown[]).length).toBe(1);
  });

  it("keeps a fresh install writable: a brand-new store is not an adoption", async () => {
    const catalog = (await api("GET", "/api/instances")).body.instances;
    const instance = catalog.find((entry: { models?: { options?: unknown[] } }) => entry.models?.options?.length);
    const created = await api("POST", "/api/bots", {
      name: "Fresh",
      modelSelection: { instanceId: instance.instanceId, model: instance.models.options[0].id },
    });
    expect(created.status).toBe(201);
    const freshBot = created.body.bot.id;
    mkdirSync(join(fixture.info.dataDir, "workspaces", freshBot), { recursive: true });

    const write = await api("POST", `/api/bots/${freshBot}/memory/records`, {
      category: "episodic_event",
      headline: "First note",
      detail: "The first thing this bot learns.",
      confidence: 0.9,
      sourceTurnId: "downgrade-fresh",
    });
    expect(write.status).toBe(200);
    expect((await api("GET", `/api/bots/${freshBot}/memory/records`)).body.count).toBe(1);
  });
});
