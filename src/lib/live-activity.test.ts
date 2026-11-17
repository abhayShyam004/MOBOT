import { describe, expect, it } from "vitest";

import { liveActivityLabel, humanizeToolFallback } from "./live-activity";
import type { Message } from "@/state/store";

const activity = (name: string, extra: Partial<NonNullable<Message["tool"]>> = {}): Message => ({
  id: "activity",
  at: 1,
  role: "bot",
  kind: "activity",
  tool: { ...extra, name },
});

describe("liveActivityLabel", () => {
  it("shows thinking before a tool starts and after it settles", () => {
    expect(liveActivityLabel()).toBe("Thinking");
    expect(liveActivityLabel(activity("Read", { ok: true }))).toBe("Thinking");
  });

  it("uses the server's narration for the exact live action", () => {
    expect(liveActivityLabel(activity("Edit", { spoken: "editing a file" }))).toBe(
      "Editing a file",
    );
  });

  it("prefers the canonical label over a raw registry key", () => {
    expect(
      liveActivityLabel(
        activity("android_computer_project_start", {
          label: "Starting the project",
          spoken: "starting the project",
        }),
      ),
    ).toBe("Starting the project");
  });

  it("maps common native and MCP tool names when narration is unavailable", () => {
    expect(liveActivityLabel(activity("Bash: pnpm test"))).toBe("Running a command");
    expect(liveActivityLabel(activity("mcp__computer__click"))).toBe("Using the computer");
    expect(liveActivityLabel(activity("web_search"))).toBe("Searching the web");
    expect(liveActivityLabel(activity("delegate_bot"))).toBe("Handing off a task");
    expect(liveActivityLabel(activity("ask_bot"))).toBe("Asking a teammate");
    expect(liveActivityLabel(activity("list_rooms"))).toBe("Checking the groups");
    expect(liveActivityLabel(activity("post_to_room"))).toBe("Posting in a group");
  });

  it("does not present bot-to-bot communication chips as the active action", () => {
    expect(
      liveActivityLabel({
        ...activity("ask_bot"),
        comm: { groupId: "room", withBotId: "bot", withName: "Peer", withColor: "blue" },
      }),
    ).toBe("Thinking");
  });
});

describe("humanizeToolFallback", () => {
  it("maps known tool names to friendly verb phrases", () => {
    expect(humanizeToolFallback("run_command")).toBe("Running a command");
    expect(humanizeToolFallback("read_file")).toBe("Reading a file");
    expect(humanizeToolFallback("write_file")).toBe("Writing a file");
    expect(humanizeToolFallback("edit_file")).toBe("Editing a file");
    expect(humanizeToolFallback("web_search")).toBe("Searching the web");
    expect(humanizeToolFallback("screenshot")).toBe("Looking at the screen");
  });

  it("strips MCP and driver prefixes before matching", () => {
    expect(humanizeToolFallback("mcp__computer__click")).toBe("Using the computer");
    expect(humanizeToolFallback("mcp__github__search_issues")).toBe("Searching");
    expect(humanizeToolFallback("android_browser_read_page")).toBe("Reading a page");
  });

  it("never outputs raw identifier and falls back to a neutral action label", () => {
    const fallback = humanizeToolFallback("mcp__unknown_server__unrecognized_call");
    expect(fallback).toBe("Working on a step");
    expect(fallback).not.toContain("mcp__");
    expect(fallback).not.toContain("unrecognized_call");
  });
});
