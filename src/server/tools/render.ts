import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const selector = z.union([z.number(), z.string()]);

export const renderTool: ToolDefinition = {
  name: 'render',
  title: 'Render & Frame Preview',
  description:
    'Save a single composition frame to PNG, queue a composition to the After Effects Render Queue, inspect queue status, or clear the render queue.',
  inputSchema: {
    action: z
      .enum(['frame', 'queue', 'status', 'clear'])
      .default('status')
      .describe('Operation to perform.'),
    comp: selector
      .optional()
      .describe('Composition id or name. Defaults to the active composition.'),
    time: z
      .number()
      .optional()
      .describe('Frame time in seconds for action="frame". Defaults to comp.time.'),
    path: z
      .string()
      .min(1)
      .optional()
      .describe('Output PNG path for action="frame". Defaults to a temp file in %TEMP%/offhand.'),
    output: z
      .string()
      .min(1)
      .optional()
      .describe('Output media file path for action="queue".'),
    template: z
      .string()
      .optional()
      .describe('Render settings template name for action="queue" (e.g. "Best Settings").'),
    outputModule: z
      .string()
      .optional()
      .describe('Output module template name for action="queue" (e.g. "Lossless").'),
    start: z
      .boolean()
      .optional()
      .describe('Start rendering immediately after queuing (default false). Note: synchronous in AE.'),
    confirm: z
      .boolean()
      .optional()
      .describe('Required true for action="clear".'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call('render', args, { timeoutMs: 120_000 });
    return textResult(data);
  },
};
