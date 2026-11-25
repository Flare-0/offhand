export type OffhandErrorCode =
  | 'INVALID_ARGS'
  | 'INVALID_JSON'
  | 'BRIDGE_OFFLINE'
  | 'BRIDGE_DISCONNECTED'
  | 'BRIDGE_TIMEOUT'
  | 'BRIDGE_STALE'
  | 'PANEL_NOT_RUNNING'
  | 'TOKEN_MISMATCH'
  | 'VERSION_MISMATCH'
  | 'AUTH_FAILED'
  | 'AE_BUSY'
  | 'HOST_ERROR'
  | 'UNKNOWN_TOOL'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'EXECUTE_ERROR'
  | 'DOC_NOT_FOUND';

export interface SerializedError {
  code: string;
  message: string;
  hint?: string;
  details?: unknown;
}

export class OffhandError extends Error {
  readonly code: OffhandErrorCode;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(
    code: OffhandErrorCode,
    message: string,
    options: { hint?: string; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OffhandError';
    this.code = code;
    this.hint = options.hint;
    this.details = options.details;
  }
}

export function toOffhandError(error: unknown): OffhandError {
  if (error instanceof OffhandError) return error;

  if (error instanceof Error) {
    const withCode = error as Error & { code?: string; hint?: string; details?: unknown };
    const code = typeof withCode.code === 'string' ? withCode.code : 'HOST_ERROR';
    return new OffhandError(code as OffhandErrorCode, error.message, {
      hint: withCode.hint,
      details: withCode.details,
      cause: error,
    });
  }

  return new OffhandError('HOST_ERROR', String(error));
}

export function serializeError(error: unknown): SerializedError {
  const normalized = toOffhandError(error);
  return {
    code: normalized.code,
    message: normalized.message,
    ...(normalized.hint ? { hint: normalized.hint } : {}),
    ...(normalized.details === undefined ? {} : { details: normalized.details }),
  };
}

export function formatError(error: unknown): string {
  const serialized = serializeError(error);
  const hint = serialized.hint ? `\nHint: ${serialized.hint}` : '';
  return `[${serialized.code}] ${serialized.message}${hint}`;
}
