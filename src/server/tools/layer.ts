import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const selector = z.union([z.number(), z.string()]);
const colorSchema = z.union([z.string(), z.array(z.number()).min(3).max(4)]);

export const layerTool: ToolDefinition = {
  name: 'layer',
  title: 'Layer',
  description:
    'List, inspect, create, update, duplicate, reorder, or delete layers in a composition. Deleting requires confirm: true.',
  inputSchema: {
    action: z
      .enum(['list', 'get', 'create', 'set', 'duplicate', 'reorder', 'delete'])
      .default('list')
      .describe('Operation to perform.'),
    comp: selector
      .optional()
      .describe('Composition id or name. Defaults to the active composition.'),
    layer: selector
      .optional()
      .describe('Layer index (1-based) or name. Defaults to the first selected layer.'),
    type: z
      .enum(['text', 'solid', 'null', 'shape', 'camera', 'light', 'comp', 'footage'])
      .optional()
      .describe('Layer type for action="create".'),
    name: z.string().optional().describe('Layer name.'),
    text: z.string().optional().describe('Initial text for type="text".'),
    color: colorSchema.optional().describe('Solid color as "#rrggbb" or [r, g, b].'),
    width: z.number().positive().optional().describe('Solid width in pixels.'),
    height: z.number().positive().optional().describe('Solid height in pixels.'),
    duration: z.number().positive().optional().describe('Layer duration in seconds.'),
    adjustment: z.boolean().optional().describe('Make newly created solid an adjustment layer.'),
    source: selector
      .optional()
      .describe('Project item id or name for type="comp" or type="footage".'),
    position: z.array(z.number()).min(2).max(3).optional().describe('Initial [x, y] or [x, y, z] position.'),
    startTime: z.number().optional().describe('Layer start time in seconds.'),
    stretch: z.number().optional().describe('Layer time stretch percentage.'),
    inPoint: z.number().optional().describe('Layer in point in seconds.'),
    outPoint: z.number().optional().describe('Layer out point in seconds.'),
    enabled: z.boolean().optional().describe('Layer visibility toggle.'),
    locked: z.boolean().optional().describe('Layer lock toggle.'),
    solo: z.boolean().optional().describe('Layer solo toggle.'),
    shy: z.boolean().optional().describe('Layer shy toggle.'),
    label: z.number().int().min(0).max(16).optional().describe('Layer label color index (0–16).'),
    comment: z.string().optional().describe('Layer comment.'),
    blendMode: z.union([z.string(), z.number()]).optional().describe('Blending mode name (e.g. "normal", "multiply", "screen").'),
    parent: z.union([selector, z.null()]).optional().describe('Parent layer index/name, or null to unparent.'),
    index: z.number().int().min(1).optional().describe('Target 1-based layer index for action="reorder".'),
    confirm: z.boolean().optional().describe('Required true for action="delete".'),
    limit: z.number().int().min(1).max(200).optional().describe('Maximum layers for action="list".'),
    offset: z.number().int().min(0).optional().describe('Pagination offset for action="list".'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call('layer', args);
    return textResult(data);
  },
};
