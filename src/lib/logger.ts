const sensitiveKey = /(?:password|passphrase|secret|token|cookie|authorization|email|evidence|database.?url|connection.?string)/iu;
const emailPattern = /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

function redactText(value: string) {
  return value
    .replace(emailPattern, "[REDACTED_EMAIL]")
    .replace(/\bBearer\s+[^\s]+/giu, "Bearer [REDACTED]")
    .replace(/(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s]+/giu, "[REDACTED_URL]");
}

export function redactLogValue(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "bigint") return value.toString();
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, "", seen));
  const output: Record<string, unknown> = {};
  for (const [entryKey, entry] of Object.entries(value)) output[entryKey] = redactLogValue(entry, entryKey, seen);
  return output;
}

export function createStructuredLogger({
  write = (line: string) => console.log(line),
  now = () => new Date(),
}: {
  write?: (line: string) => void;
  now?: () => Date;
} = {}) {
  const log = (level: "info" | "warn" | "error", message: string, context?: unknown) => {
    write(JSON.stringify({ timestamp: now().toISOString(), level, message: redactText(message), ...(context === undefined ? {} : { context: redactLogValue(context) }) }));
  };
  return {
    info: (message: string, context?: unknown) => log("info", message, context),
    warn: (message: string, context?: unknown) => log("warn", message, context),
    error: (message: string, context?: unknown) => log("error", message, context),
  };
}

export const logger = createStructuredLogger();
