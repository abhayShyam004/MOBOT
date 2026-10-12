// Types for the Phase 5 remote MCP fixture generator (plain .mjs): renders the
// deterministic streamable-HTTP / legacy-SSE MCP server used by the device
// driver and the CI spawn tests.
export declare function remoteMcpFixtureScript(
  port: number,
  transport?: "http" | "sse",
  effectFile?: string,
): string;
