/**
 * Test-only crash injection for the memory commit protocol.
 *
 * The commit is a sequence of four durable steps — prepare (signer), records,
 * manifest, commit (signer) — and every crash-recovery claim is about what the
 * *next* boot does when the process dies between two of them. A unit test can
 * fabricate those states, but only the device can prove the real writer
 * produces them.
 *
 * The switch is one environment variable, `OMB_MEMORY_CRASH_POINT`, and it is
 * set by the Android harness for the **preview build only**, from
 * `settings put global omb_crash_point <point>`; nothing in the app, the agent
 * shell, or any request can set it. When it matches a transition the process
 * SIGKILLs itself: no handler, no flush, no cleanup, which is exactly what an
 * OOM kill or `am force-stop` looks like to the protocol.
 *
 * There is no behavior beyond dying, so the hook cannot be used to weaken a
 * check: if the variable is unset — every production boot — every call is a
 * single string comparison.
 */
export type MemoryCrashPoint =
  | "before-prepare"
  | "after-prepare"
  | "after-records"
  | "after-manifest"
  | "before-commit"
  | "after-commit"
  | "after-response";

const POINTS = new Set<string>([
  "before-prepare",
  "after-prepare",
  "after-records",
  "after-manifest",
  "before-commit",
  "after-commit",
  "after-response",
]);

/** True when this boot was told to die at a transition. Diagnostics only. */
export function memoryCrashPoint(): MemoryCrashPoint | null {
  const value = process.env.OMB_MEMORY_CRASH_POINT;
  return value && POINTS.has(value) ? (value as MemoryCrashPoint) : null;
}

/** Die here if, and only if, this boot was told to. Never returns when armed. */
export function maybeCrashMemory(point: MemoryCrashPoint): void {
  if (process.env.OMB_MEMORY_CRASH_POINT !== point) return;
  process.kill(process.pid, "SIGKILL");
}
