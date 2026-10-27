import { describe, expect, it } from "vitest";
import { humanizeApprovalRequest, isReadOnlyTool, humanLabelForPackage } from "./approval-humanizer.ts";
import { approvalHeldNote } from "./auto-approve.ts";

describe("Approval Humanizer (Bug C Remediation)", () => {
  describe("humanLabelForPackage", () => {
    it("maps known packages to friendly names", () => {
      expect(humanLabelForPackage("com.discord")).toBe("Discord");
      expect(humanLabelForPackage("com.whatsapp")).toBe("WhatsApp");
      expect(humanLabelForPackage("com.google.android.gm")).toBe("Gmail");
      expect(humanLabelForPackage("com.slack")).toBe("Slack");
      expect(humanLabelForPackage("com.spotify.music")).toBe("Spotify");
    });

    it("formats unknown reverse-DNS packages into readable names", () => {
      expect(humanLabelForPackage("com.example.invoiceviewer")).toBe("Invoiceviewer");
    });
  });

  describe("isReadOnlyTool", () => {
    it("identifies read-only Gmail tools", () => {
      expect(isReadOnlyTool("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID")).toBe(true);
      expect(isReadOnlyTool("GMAIL_LIST_MESSAGES")).toBe(true);
      expect(isReadOnlyTool("mcp__composio__GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID")).toBe(true);
    });

    it("identifies write/mutation Gmail tools", () => {
      expect(isReadOnlyTool("GMAIL_SEND_EMAIL")).toBe(false);
      expect(isReadOnlyTool("GMAIL_CREATE_DRAFT")).toBe(false);
    });

    it("identifies device inspection tools", () => {
      expect(isReadOnlyTool("read_screen")).toBe(true);
      expect(isReadOnlyTool("take_screenshot")).toBe(true);
      expect(isReadOnlyTool("get_location")).toBe(true);
      expect(isReadOnlyTool("list_apps")).toBe(true);
      expect(isReadOnlyTool("open_app")).toBe(false);
      expect(isReadOnlyTool("tap")).toBe(false);
      expect(isReadOnlyTool("type_text")).toBe(false);
    });
  });

  describe("humanizeApprovalRequest", () => {
    it("formats GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID into a clean read-only approval contract without raw JSON", () => {
      const res = humanizeApprovalRequest({
        tool: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
        summary: '{"user_id": "me", "message_id": "1948ac7912e"}',
        parameters: { user_id: "me", message_id: "1948ac7912e" },
      });

      expect(res.title).toBe("Read Email");
      expect(res.category).toBe("read");
      expect(res.isReadOnly).toBe(true);
      expect(res.target).toBe("Gmail (me)");
      expect(res.subtitle).toContain("1948ac7912e");
      // Must not leak raw JSON curly braces or quote-colon syntax
      expect(res.subtitle).not.toContain("{");
      expect(res.subtitle).not.toContain("}");
      expect(res.subtitle).not.toContain('"user_id":');
    });

    it("formats GMAIL_LIST_MESSAGES into a clean search action", () => {
      const res = humanizeApprovalRequest({
        tool: "GMAIL_LIST_MESSAGES",
        summary: '{"q": "invoice", "user_id": "me"}',
        parameters: { q: "invoice", user_id: "me" },
      });

      expect(res.title).toBe("Search Emails");
      expect(res.category).toBe("read");
      expect(res.isReadOnly).toBe(true);
      expect(res.subtitle).toContain("invoice");
      expect(res.subtitle).not.toContain("{");
    });

    it("formats open_app for Discord without raw JSON", () => {
      const res = humanizeApprovalRequest({
        tool: "open_app",
        parameters: { packageName: "com.discord" },
      });

      expect(res.title).toBe("Open Discord");
      expect(res.category).toBe("action");
      expect(res.isReadOnly).toBe(false);
      expect(res.subtitle).toBe("MOBOT wants to open Discord (com.discord) on your device.");
    });

    it("formats open_app for WhatsApp without raw JSON", () => {
      const res = humanizeApprovalRequest({
        tool: "device.phone_control",
        summary: '{"packageName": "com.whatsapp"}',
      });

      expect(res.title).toBe("Open WhatsApp");
      expect(res.category).toBe("action");
      expect(res.subtitle).toBe("MOBOT wants to open WhatsApp (com.whatsapp) on your device.");
    });

    it("cleans up raw JSON in generic tools", () => {
      const res = humanizeApprovalRequest({
        tool: "custom_service_lookup",
        summary: '{"account_id": "456", "query": "status"}',
      });

      expect(res.subtitle).not.toContain("{");
      expect(res.subtitle).not.toContain("}");
      expect(res.subtitle).toContain("account_id: 456");
      expect(res.subtitle).toContain("query: status");
    });
  });

  describe("Truthful Held Notes (Eliminates false sandbox escalation)", () => {
    it("never shows sandbox widening message for read-only tools", () => {
      // Even if source is explicit-approval-block, read-only tools must use native held note
      const note = approvalHeldNote({
        source: "explicit-approval-block",
        permission: true,
        tool: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      });

      expect(note).toBe("approval.held.native");
      expect(note).not.toBe("approval.held.sandbox");
    });

    it("preserves sandbox widening message only for genuine mutation/sandbox commands", () => {
      const note = approvalHeldNote({
        source: "explicit-approval-block",
        permission: true,
        tool: "shell",
        summary: "rm -rf /",
      });

      expect(note).toBe("approval.held.sandbox");
    });
  });
});
