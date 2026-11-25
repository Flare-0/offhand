// Panel -> ExtendScript. One typed entry point: `dispatch(tool, argsJson)` in
// `src/jsx/aeft/aeft.ts` returns a JSON envelope `{ok, data}` / `{ok, error}`.

import { evalTS } from "../lib/utils/bolt";
import type { SerializedError } from "./types";

export type HostPayload =
  | { ok: true; data?: unknown }
  | { ok: false; error: SerializedError };

export class HostCallError extends Error {
  code: string;
  hint?: string;

  constructor(error: SerializedError) {
    super(error.message);
    this.name = "HostCallError";
    this.code = error.code;
    this.hint = error.hint;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asError = (value: unknown): SerializedError => {
  if (isObject(value)) {
    const code = typeof value.code === "string" ? value.code : "HOST_ERROR";
    const message =
      typeof value.message === "string" ? value.message : String(value.message);
    const hint = typeof value.hint === "string" ? value.hint : undefined;
    return { code, message, hint };
  }
  return { code: "HOST_ERROR", message: String(value) };
};

/**
 * `evalTS` resolves with whatever the host returned after one JSON.parse, and
 * rejects when it looks like an error object. The host returns a JSON *string*,
 * so it can arrive as either a string or an already-parsed object.
 */
const normalize = (raw: unknown): HostPayload => {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { ok: true, data: raw };
    }
  }
  if (isObject(value) && typeof value.ok === "boolean") {
    if (value.ok) return { ok: true, data: value.data };
    return { ok: false, error: asError(value.error) };
  }
  return { ok: true, data: value };
};

/** Calls a host tool and returns its data, throwing `HostCallError` on failure. */
export const callHost = async (
  tool: string,
  args: unknown,
): Promise<unknown> => {
  let raw: unknown;
  try {
    raw = await evalTS("dispatch", tool, JSON.stringify(args ?? {}));
  } catch (error) {
    throw new HostCallError(asError(error));
  }

  const payload = normalize(raw);
  if (!payload.ok) throw new HostCallError(payload.error);
  return payload.data;
};
