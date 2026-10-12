// The environment one MCP child process may see.
//
// Written once, used by the two spawn sites (mcp-probe.ts's connection test
// and chat-mcp-tools.ts's per-turn mounts): a custom MCP server keeps a
// normal process environment MINUS credentials that belong to other
// components. A foreign provider key riding along in `...process.env` must
// not reach a third-party server's process — it could log it, forward it, or
// switch some CLI's billing identity (the threat WORKSPACE_CREDENTIAL_ENV
// documents for workspace CLIs, and it applies to any spawned helper).
import { PROVIDER_CREDENTIAL_ENV, WORKSPACE_CREDENTIAL_ENV } from "./config.ts";

/** Keys never inherited from the harness environment by a spawned MCP
 * server. The lists are the same ones every other spawned helper in this
 * codebase is subject to, so an MCP server is not a credential-laundering
 * side channel. A key the user explicitly wrote into a server's own env
 * block is honored — that is the documented way to hand one server its own
 * credential (the registry still blocks harness-reserved OMB_/OGB_ names). */
const MCP_DENIED_ENV = new Set<string>([...WORKSPACE_CREDENTIAL_ENV, ...PROVIDER_CREDENTIAL_ENV]);

/** `{...process.env, ...extra}` with every denied key removed from the
 * inherited part. `extra` (the server's configured env) is applied verbatim
 * and may therefore re-introduce a name deliberately — an explicit grant in
 * the config — but never inherits one by accident. */
export function mcpChildEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    // `process.env.X = undefined` coerces to the literal string "undefined"
    // (Node >= 22 keeps it as a string entry) — never forward that as a
    // value; a child must not mistake it for a real setting.
    if (value !== undefined && value !== "undefined" && !MCP_DENIED_ENV.has(key)) env[key] = value;
  }
  return Object.assign(env, extra ?? {});
}
