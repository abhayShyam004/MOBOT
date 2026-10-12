// Types for the Phase 7 browser fixture generator (plain .mjs, imported by
// server/browser-fixture.test.ts and by the device driver).
export declare function browserFixtureHtml(page?: string): string;
export declare function browserFixtureFiles(): Record<string, string>;
export declare function browserFixtureServerScript(): string;
