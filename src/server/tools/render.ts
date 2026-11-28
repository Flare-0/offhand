import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const selector = z.union([z.number(), z.string()]);

type PendingRender = {
  statusFile: string;
  response: Record<string, unknown>;
  startedAt: number;
};

// The host writes this marker before scheduling a render and overwrites it when
// AE finishes. While it says "rendering", answering status/jobs from this cache
// avoids a bridge call that would block on AE's single-threaded script engine.
// The age guard keeps a marker orphaned by an AE crash from masking the bridge
// forever.
const PENDING_MAX_MS = 12 * 60 * 60 * 1000;
let pendingRender: PendingRender | null = null;

function statusFileState(path: string): 'rendering' | 'done' | 'error' | 'missing' {
  try {
    if (!existsSync(path)) return 'missing';
    const text = readFileSync(path, 'utf8').trim().toLowerCase();
    if (text.startsWith('done')) return 'done';
    if (text.startsWith('error')) return 'error';
    return 'rendering';
  } catch {
    return 'missing';
  }
}

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
    const action = String(args.action ?? 'status');
    if (pendingRender && (action === 'jobs' || action === 'status')) {
      const bridgeState =
        typeof context.bridge.status === 'function' ? context.bridge.status().state : 'ready';
      const expired = Date.now() - pendingRender.startedAt > PENDING_MAX_MS;
      const state = statusFileState(pendingRender.statusFile);
      if (state === 'rendering' && bridgeState === 'ready' && !expired) {
        return textResult({
          ...pendingRender.response,
          rendering: true,
          note: 'After Effects is still rendering; this is the last known state. Call again shortly.',
        });
      }
      pendingRender = null;
    }

    const data = await context.bridge.call('render', args, { timeoutMs: 120_000 });
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const record = data as Record<string, unknown>;
      const statusFile = record.statusFile;
      delete record.statusFile;
      if (
        typeof statusFile === 'string' &&
        statusFile.length > 0 &&
        (action === 'start' || (action === 'queue' && args.start === true))
      ) {
        pendingRender = { statusFile, response: record, startedAt: Date.now() };
      }
      if (action === 'clear') pendingRender = null;
    }
    return textResult(data);
  },
};
