import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const selector = z.union([z.number(), z.string()]);

export const viewTool: ToolDefinition = {
  name: 'view',
  title: 'Viewer & Playhead',
  description:
    'Open a composition in the After Effects viewer, move the playhead time, or select layers in a composition.',
  inputSchema: {
    action: z
      .enum(['open', 'time', 'select'])
      .default('open')
      .describe('Operation to perform.'),
    comp: selector
      .optional()
      .describe('Composition id or name. Defaults to the active composition.'),
    time: z
      .number()
      .optional()
      .describe('Playhead time in seconds for action="time".'),
    layer: selector
      .optional()
      .describe('Layer index or name to select for action="select".'),
    layers: z
      .array(selector)
      .optional()
      .describe('Multiple layer indices or names to select for action="select".'),
    deselect: z
      .boolean()
      .optional()
      .describe('Clear existing selection before selecting (default true).'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call('view', args);
    return textResult(data);
  },
};
