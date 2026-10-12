// CI regression test for the deterministic browser fixture. The device driver
// serves exactly these bytes on the phone (from an on-device node listener) and
// the agent task's form → result round-trip depends on them, so the contract is
// pinned here: if the fixture drifts, the phone run would chase the wrong
// failure.
import { describe, expect, it } from "vitest";
import {
  browserFixtureFiles,
  browserFixtureHtml,
  browserFixtureServerScript,
} from "../scripts/lib/omb-browser-fixture.mjs";

describe("browser fixture (scripts/lib/omb-browser-fixture.mjs)", () => {
  it("home page carries the form, the input, and the links the matrix drives", () => {
    const html = browserFixtureHtml("index");
    expect(html).toContain('id="the-form"');
    expect(html).toContain('action="/result.html"');
    expect(html).toContain('name="value"');
    expect(html).toContain('id="to-result"');
    expect(html).toContain('id="to-redirect"');
    expect(html).toContain("Secret word");
    expect(html).toContain("Send it");
  });

  it("result page echoes the submitted value the agent task asserts", () => {
    const html = browserFixtureHtml("result");
    expect(html).toContain('id="value"');
    expect(html).toContain("URLSearchParams");
    expect(html).toContain('params.get("value")');
    expect(html).toContain("Submitted value: ");
  });

  it("redirect page forwards to the result page", () => {
    expect(browserFixtureHtml("redirect")).toContain("url=/result.html?value=redirected");
  });

  it("defaults to the home page", () => {
    expect(browserFixtureHtml()).toBe(browserFixtureHtml("index"));
  });

  it("deterministic: identical bytes every run", () => {
    expect(browserFixtureHtml("index")).toBe(browserFixtureHtml("index"));
  });

  it("the pushed files are the same bytes the assertions read", () => {
    const files = browserFixtureFiles();
    expect(Object.keys(files).sort()).toEqual(["index.html", "redirect.html", "result.html"]);
    expect(files["index.html"]).toBe(browserFixtureHtml("index"));
    expect(files["result.html"]).toBe(browserFixtureHtml("result"));
    expect(files["redirect.html"]).toBe(browserFixtureHtml("redirect"));
  });

  it("the on-device server script is generic (pages come from the pushed files)", () => {
    const server = browserFixtureServerScript();
    expect(server).toContain('listen(port, "127.0.0.1"');
    expect(server).not.toContain("OMB Fixture — Home");
  });
});
