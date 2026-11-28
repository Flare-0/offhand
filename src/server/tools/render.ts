import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const selector = z.union([z.number(), z.string()]);

export const renderTool: ToolDefinition = {
  name: 'render',
  title: 'Render & Frame Preview',
  description:
    'Save a single composition frame to PNG, queue a composition to the After Effects Render Queue, start a queued render job, inspect jobs and queue status, or clear the render queue. Always render MP4/H.264 unless the user explicitly asks for another format: pass output ending in .mp4 and the host applies the H.264 output-module template automatically. action=start schedules the render and returns immediately; poll action=jobs for completion. Render jobs survive panel reloads because queued items are adopted from the render queue.',
  inputSchema: {
    action: z
      .enum(['frame', 'queue', 'start', 'jobs', 'status', 'clear'])
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
      .describe(
        'Output media file path for action="queue". Prefer an .mp4 path: the host applies the H.264 output-module template automatically. Only use another format when the user explicitly asks for it.',
      ),
    template: z
      .string()
      .optional()
      .describe('Render settings template name for action="queue" (e.g. "Best Settings").'),
    outputModule: z
      .string()
      .optional()
      .describe(
        'Output module template name for action="queue" (e.g. "H.264 - Match Render Settings - 15 Mbps"). Optional: an .mp4 output selects an H.264 template automatically.',
      ),
    start: z
      .boolean()
      .optional()
      .describe('Start rendering immediately after queuing (default false). Returns after scheduling; poll action="jobs".'),
    job: z
      .string()
      .optional()
      .describe('Render job id for action="start". Defaults to every queued job.'),
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
