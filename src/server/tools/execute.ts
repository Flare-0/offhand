import { z } from 'zod';
import { capText, textResult } from './result.js';
import type { ToolDefinition } from './types.js';

export const executeTool: ToolDefinition = {
  name: 'execute',
  title: 'Run ExtendScript',
  description:
    'LAST RESORT. Run raw ExtendScript inside After Effects. Use only when no typed tool covers the task; it can do anything to the open project. Write tools run inside an undo group. The call is logged with your reason. Prefer comp, layer, property, effect, text, shape, mask, render, and assets.',
  inputSchema: {
    script: z
      .string()
      .min(1)
      .max(200_000)
      .describe('ExtendScript source. Return a JSON-serializable value for the result.'),
    reason: z
      .string()
      .min(5)
      .max(500)
      .describe('Why the typed tools cannot do this. Logged so missing tools can be added.'),
    timeout_ms: z
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(30_000)
      .describe('How long to wait for the script to finish, in milliseconds.'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call(
      'execute',
      { script: args.script, reason: args.reason },
      { timeoutMs: args.timeout_ms },
    );

    if (
      data &&
      typeof data === 'object' &&
      'result' in data &&
      typeof (data as { result: unknown }).result === 'string'
    ) {
      return textResult({
        ...data,
        result: capText((data as { result: string }).result),
      });
    }

    return textResult(data);
  },
};
