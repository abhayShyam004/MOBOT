import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function logHopTiming(hop: string, durationMs: number, meta?: Record<string, any>) {
  const filePath = existsSync("/sdcard/Download") ? "/sdcard/Download/mobot_timing.log" : "/tmp/mobot_timing.log";
  const entry = {
    timestamp: new Date().toISOString(),
    hop,
    durationMs: Math.round(durationMs),
    ...meta,
  };
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(filePath, JSON.stringify(entry) + "\n");
  } catch {
    // Fail silently in production
  }
}
