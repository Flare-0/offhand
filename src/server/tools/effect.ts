import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const selector = z.union([z.number(), z.string()]);

export const effectTool: ToolDefinition = {
  name: 'effect',
  title: 'Effect',
  description:
    'List effects on a layer, search installed After Effects effects, add an effect by name or matchName, set an effect property, or remove an effect.',
  inputSchema: {
    action: z
      .enum(['list', 'search', 'add', 'set', 'remove'])
      .default('list')
      .describe('Operation to perform.'),
    comp: selector
      .optional()
      .describe('Composition id or name. Defaults to the active composition.'),
    layer: selector
      .optional()
      .describe('Layer index or name. Defaults to the first selected layer.'),
    query: z
      .string()
      .optional()
      .describe('Search term for action="search" (e.g. "glow", "blur").'),
    effect: selector
      .optional()
      .describe('Effect matchName, display name, or 1-based index on the layer.'),
    property: selector
      .optional()
      .describe('Effect property name, matchName, or 1-based index for action="set".'),
    value: z
      .unknown()
      .optional()
      .describe('New property value for action="set".'),
    time: z
      .number()
      .optional()
      .describe('Optional keyframe time in seconds for action="set".'),
    enabled: z
      .boolean()
      .optional()
      .describe('Enable or disable the effect in action="set".'),
    confirm: z
      .boolean()
      .optional()
      .describe('Required true for action="remove".'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum results for action="search" or action="list".'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call('effect', args);
    return textResult(data);
  },
};
