import "server-only";

import { z } from "zod";

import { AppError } from "./errors";

/** Largest accepted JSON body. Our biggest real payload (a profile) is < 2 KB. */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * Body of a POST that carries no data (e.g. register): must be exactly `{}`. Still parsed with
 * parseJson, so the JSON content-type rule (our CSRF defence) holds for every mutation.
 */
export const emptyBodySchema = z.strictObject({}, { error: "request body must be {}" });

function validationError(issues: readonly z.core.$ZodIssue[], where: string): AppError {
  return new AppError("VALIDATION_FAILED", `Invalid ${where}.`, {
    details: issues.map((issue) => ({
      path: issue.path.map(String).join(".") || "(root)",
      message: issue.message,
    })),
  });
}

function check<S extends z.ZodType>(schema: S, value: unknown, where: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error.issues, where);
  return result.data;
}

function tooLarge(): AppError {
  return new AppError("PAYLOAD_TOO_LARGE", `Request body must be at most ${MAX_BODY_BYTES} bytes.`);
}

/** Read the body as text, refusing more than MAX_BODY_BYTES even without a Content-Length. */
async function readLimited(req: Request): Promise<string> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw tooLarge();
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Parse + validate a JSON body. Requires `Content-Type: application/json`: browsers can send
 * text/plain or form posts cross-site without a CORS preflight, JSON they cannot — so this
 * is also a CSRF defence for our cookie-authenticated endpoints.
 */
export async function parseJson<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<z.output<S>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }
  const text = await readLimited(req);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_FAILED", "Request body must be valid JSON.");
  }
  return check(schema, json, "request body");
}

/** Validate query-string parameters (single-valued; repeated keys keep the last value). */
export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  return check(schema, params, "query parameters");
}

/** Validate dynamic route segments (`ctx.params` is a Promise in Next 16). */
export async function parseParams<S extends z.ZodType>(
  params: Promise<unknown>,
  schema: S,
): Promise<z.output<S>> {
  return check(schema, await params, "path parameters");
}
