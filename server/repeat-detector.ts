// Noticing a bot that is going in circles: the same tool call, the same
// arguments, again and again in one turn. Nothing watched for that, and
// it is the user's money. This only OBSERVES — it counts and says so; the
// human has Stop. Cutting a call off, or steering the model, needs the
// harness to own the call or to be able to speak mid-turn, neither of which
// is true for CLI drivers today (see plan items 3.2 / 3.3).

export const ERR_REPEATED_ACTION_LOOP = "ERR_REPEATED_ACTION_LOOP";

/**
 * Truly volatile keys that represent request-tracing nonces, timestamps, or client-side caching tokens.
 * NOTE: Resource identifiers such as `id`, `uuid`, `botId`, `eventId`, `path`, etc. are NEVER in this list,
 * as they represent meaningful targets that must remain distinguishable.
 */
const DEFAULT_VOLATILE_KEY_PATTERN =
  /^(?:requestId|clientRequestId|correlationId|traceId|spanId|nonce|_nonce|cacheBuster|clientTimestamp|_t|ts|timestamp)$/i;

/**
 * Sensitive parameter keys whose values must be redacted to prevent leaking secrets into action keys or telemetry.
 */
const DEFAULT_SENSITIVE_KEY_PATTERN =
  /^(?:password|secret|token|apiKey|auth|credential|bearer|authorization|privateKey)$/i;

export interface ActionKeyNormalizationOptions {
  volatileKeys?: string[];
  sensitiveKeys?: string[];
  keepVolatileKeys?: boolean;
}

function sanitizeParamValue(key: string, value: unknown, customSensitiveKeys?: string[]): string {
  if (value === undefined || value === null) {
    return "";
  }

  const isSensitive =
    DEFAULT_SENSITIVE_KEY_PATTERN.test(key) ||
    (customSensitiveKeys && customSensitiveKeys.some((sk) => sk.toLowerCase() === key.toLowerCase()));

  if (isSensitive) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    // Proactively mask credentials embedded in string values
    if (/^(?:sk-[a-zA-Z0-9_-]{16,}|Bearer\s+[a-zA-Z0-9._-]{16,}|ghp_[a-zA-Z0-9]{16,})/i.test(value)) {
      return "[REDACTED]";
    }
    return value.replace(/\s+/g, " ").trim().toLowerCase();
  }

  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return `[${value.map((item, idx) => sanitizeParamValue(String(idx), item, customSensitiveKeys)).join(",")}]`;
    }
    // Nested object: sort keys deterministically and strip undefined fields
    const sortedObj: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
      if (v !== undefined) {
        sortedObj[k.toLowerCase()] = sanitizeParamValue(k, v, customSensitiveKeys);
      }
    }
    return JSON.stringify(sortedObj);
  }

  return String(value).toLowerCase();
}

/** Tool name plus its arguments, whitespace-normalized. A bare tool name
 * is not a call worth counting: "Bash" five times may be five different
 * commands, and Claude's item.started carries only the name. */
export function callKey(tool: string, args: string | undefined): string | null {
  const a = (args ?? "").replace(/\s+/g, " ").trim();
  if (!a || a === tool) return null;
  return `${tool}:${a}`;
}

/**
 * Normalizes an action, its capability, and arguments into a stable comparison key.
 * Strips formatting variances, volatile timestamps, request nonces, and parameter order
 * while strictly preserving meaningful resource identifiers (`id`, `path`, `botId`, etc.)
 * and redacting sensitive values to prevent telemetry leaks.
 */
export function normalizeActionKey(
  action: string,
  capabilityId?: string,
  operation?: string,
  params?: Record<string, unknown>,
  options?: ActionKeyNormalizationOptions
): string {
  const normAction = (action || "").toLowerCase().replace(/\s+/g, " ").trim();
  const normCap = (capabilityId || "").toLowerCase().trim();
  const normOp = (operation || "").toLowerCase().trim();

  let paramSignature = "";
  if (params && typeof params === "object") {
    const isVolatile = (key: string): boolean => {
      if (options?.keepVolatileKeys) return false;
      if (options?.volatileKeys && options.volatileKeys.some((vk) => vk.toLowerCase() === key.toLowerCase())) {
        return true;
      }
      return DEFAULT_VOLATILE_KEY_PATTERN.test(key);
    };

    const filteredEntries = Object.entries(params)
      .filter(([k, v]) => v !== undefined && !isVolatile(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => {
        const sanitizedVal = sanitizeParamValue(k, v, options?.sensitiveKeys);
        return `${k.toLowerCase()}=${sanitizedVal}`;
      });

    paramSignature = filteredEntries.join("&");
  }

  return `${normCap || "action"}:${normOp || normAction}:${paramSignature}`;
}

export class RepeatDetector {
  private readonly counts = new Map<string, Map<string, number>>();
  private readonly failingCounts = new Map<string, Map<string, number>>();
  private readonly thresholds: readonly number[];
  private readonly maxKeysPerThread: number;

  constructor(opts?: { thresholds?: readonly number[]; maxKeysPerThread?: number }) {
    this.thresholds = opts?.thresholds ? [...opts.thresholds].sort((a, b) => a - b) : [2, 5, 10];
    this.maxKeysPerThread = opts?.maxKeysPerThread ?? 256;
    if (!Number.isInteger(this.maxKeysPerThread) || this.maxKeysPerThread < 1) {
      throw new Error("maxKeysPerThread must be a positive integer");
    }
  }

  /** Count one call. `threshold` is set exactly when the count lands on one. */
  record(threadId: string, key: string): { count: number; threshold?: number } {
    let per = this.counts.get(threadId);
    if (!per) this.counts.set(threadId, (per = new Map()));
    const previous = per.get(key);
    // Keep a bounded, recency-ordered set instead of retaining every unique
    // command an arbitrarily long turn ever issued. Existing keys move to
    // the back; when full, the least-recently-seen signature falls out.
    if (previous !== undefined) per.delete(key);
    else if (per.size >= this.maxKeysPerThread) per.delete(per.keys().next().value!);
    const count = (previous ?? 0) + 1;
    per.set(key, count);
    return this.thresholds.includes(count) ? { count, threshold: count } : { count };
  }

  /**
   * Record a failing action invocation.
   * If the exact same failing action is attempted twice, intercepts call and flags
   * ERR_REPEATED_ACTION_LOOP to prevent infinite unhelpful loops.
   */
  recordFailingAction(
    threadId: string,
    actionKey: string
  ): { count: number; repeatedLoopDetected: boolean; error?: string } {
    let per = this.failingCounts.get(threadId);
    if (!per) this.failingCounts.set(threadId, (per = new Map()));
    const previous = per.get(actionKey);
    if (previous !== undefined) per.delete(actionKey);
    else if (per.size >= this.maxKeysPerThread) per.delete(per.keys().next().value!);
    const count = (previous ?? 0) + 1;
    per.set(actionKey, count);

    const repeatedLoopDetected = count >= 2;
    return {
      count,
      repeatedLoopDetected,
      error: repeatedLoopDetected
        ? `${ERR_REPEATED_ACTION_LOOP}: Agent attempted the exact same failing action twice (${actionKey}). Forced strategy change or termination required.`
        : undefined,
    };
  }

  /** The turn ended: a new turn starts its own count. */
  settle(threadId: string) {
    this.counts.delete(threadId);
    this.failingCounts.delete(threadId);
  }
}
