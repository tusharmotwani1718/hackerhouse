import "server-only";

import { getEnv } from "../env";
import { getRequestContext } from "./context";

/**
 * Minimal structured logger (no dependencies). Production: one JSON object per line.
 * Development: one readable line. The current request id is attached automatically.
 * Same shape as pino's API, so it can be swapped later without touching call sites.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Errors don't serialize with JSON.stringify; turn them (and their causes) into plain data. */
export function serializeError(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) return error;
  const extra = error as Error & { code?: unknown; meta?: unknown };
  return {
    name: error.name,
    message: error.message,
    ...(extra.code !== undefined && { code: extra.code }),
    stack: error.stack,
    ...(error.cause !== undefined &&
      depth < 3 && { cause: serializeError(error.cause, depth + 1) }),
  };
}

function normalize(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

function formatPretty(level: LogLevel, msg: string, fields: LogFields): string {
  const time = new Date().toISOString().slice(11, 23);
  const { err, ...rest } = fields;
  const pairs = Object.entries(rest)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  const head = `${time} ${level.toUpperCase().padEnd(5)} ${msg}${pairs ? ` ${pairs}` : ""}`;
  if (!err) return head;
  const stack = (err as { stack?: string }).stack ?? JSON.stringify(err);
  const cause = (err as { cause?: { stack?: string; message?: string } }).cause;
  // A cause may be a plain object (e.g. the driver adapter's { originalCode, ... }).
  const causeText = cause ? (cause.stack ?? cause.message ?? JSON.stringify(cause)) : undefined;
  return `${head}\n${stack}${causeText ? `\nCaused by: ${causeText}` : ""}`;
}

function write(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const env = getEnv();
  if (LEVEL_ORDER[level] < LEVEL_ORDER[env.LOG_LEVEL]) return;

  const context = getRequestContext();
  const all = normalize({
    ...(context?.requestId && { requestId: context.requestId }),
    ...(context?.userId && { userId: context.userId }),
    ...fields,
  });
  const line =
    env.NODE_ENV === "production"
      ? JSON.stringify({ time: new Date().toISOString(), level, msg, ...all })
      : formatPretty(level, msg, all);

  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
