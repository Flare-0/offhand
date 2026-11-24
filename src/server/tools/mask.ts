import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const selector = z.union([z.number(), z.string()]);

export const maskTool: ToolDefinition = {
  name: 'mask',
  title: 'Mask',
  description:
    'List, inspect, create, update, or remove layer masks using rectangle/ellipse bounds or custom path vertices.',
  inputSchema: {
    action: z
      .enum(['list', 'get', 'create', 'set', 'remove'])
      .default('list')
      .describe('Operation to perform.'),
    comp: selector
      .optional()
      .describe('Composition id or name. Defaults to the active composition.'),
    layer: selector
      .optional()
      .describe('Layer index or name. Defaults to the first selected layer.'),
    mask: selector
      .optional()
      .describe('Mask 1-based index or name for get/set/remove.'),
    name: z.string().optional().describe('Mask name.'),
    shape: z
      .enum(['rect', 'ellipse', 'path'])
      .optional()
      .describe('Mask shape for action="create" (default "rect").'),
    bounds: z
      .union([
        z.array(z.number()).length(4),
        z.object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        }),
      ])
      .optional()
      .describe('Bounds as [left, top, right, bottom] or {x, y, width, height}.'),
    vertices: z
      .array(z.array(z.number()).length(2))
      .min(2)
      .optional()
      .describe('Custom mask path vertices [[x, y], ...].'),
    closed: z.boolean().optional().describe('Whether a custom mask path is closed (default true).'),
    mode: z
      .enum(['add', 'subtract', 'intersect', 'lighten', 'darken', 'difference', 'none'])
      .optional()
      .describe('Mask blending mode.'),
    feather: z
      .union([z.number().min(0), z.array(z.number().min(0)).length(2)])
      .optional()
      .describe('Mask feather in pixels (single number or [x, y]).'),
    opacity: z.number().min(0).max(100).optional().describe('Mask opacity (0–100).'),
    expansion: z.number().optional().describe('Mask expansion in pixels.'),
    inverted: z.boolean().optional().describe('Invert mask.'),
    confirm: z.boolean().optional().describe('Required true for action="remove".'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call('mask', args);
    return textResult(data);
  },
};
