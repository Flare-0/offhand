import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const MAX_CALLS = 20;

/**
 * Runs several typed tools in one bridge round-trip. The host runs the calls
 * sequentially inside a single undo group, so one batch is one Cmd/Ctrl+Z.
 */
export const batchTool: ToolDefinition = {
  name: 'batch',
  title: 'Batch Tool Calls',
  description:
    'Run up to 20 typed tool calls sequentially in one bridge round-trip and one undo group. Use it for multi-step edits that belong together (create a comp, add layers, set properties) to cut round-trips; read each result and stop at the first failure by default. Not for `execute` unless raw scripts are enabled in the panel, and it cannot nest batch.',
  inputSchema: {
    calls: z
      .array(
        z.object({
          tool: z.string().min(1).describe('Tool name, e.g. "comp", "layer", "property".'),
          args: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('Arguments object for that tool. Omit or {} for tools with defaults.'),
        }),
      )
      .min(1)
      .max(MAX_CALLS)
      .describe('Calls to run in order.'),
    stopOnError: z
      .boolean()
      .default(true)
      .describe('Stop at the first failure (default true). Set false to run every call regardless.'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call('batch', args, { timeoutMs: 300_000 });
    return textResult(data);
  },
};
