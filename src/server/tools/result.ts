import { serializeError } from '../../shared/errors.js';
import type { ToolTextResult } from './types.js';

export function textResult(data: unknown): ToolTextResult {
  const text =
    typeof data === 'string' ? data : JSON.stringify(data === undefined ? null : data, null, 2) ?? 'null';
  return {
    content: [{ type: 'text', text }],
  };
}

export function errorResult(error: unknown): ToolTextResult {
  const serialized = serializeError(error);
  const hint = serialized.hint ? `\nHint: ${serialized.hint}` : '';
  const details =
    serialized.details === undefined
      ? ''
      : `\nDetails: ${JSON.stringify(serialized.details).slice(0, 2_000)}`;

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `[${serialized.code}] ${serialized.message}${hint}${details}`,
      },
    ],
  };
}

export function capText(text: string, limit = 50_000): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[Truncated: showing ${limit} of ${text.length} characters. Narrow the request or read the result from a file.]`;
}
