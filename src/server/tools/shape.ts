import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const selector = z.union([z.number(), z.string()]);
const colorSchema = z.union([z.string(), z.array(z.number()).min(3).max(4)]);

export const shapeTool: ToolDefinition = {
  name: 'shape',
  title: 'Shape Layer',
  description:
    'Create, inspect, or update vector shape layers (rectangle, ellipse, star, polygon, or custom path) with fill and stroke styling.',
  inputSchema: {
    action: z
      .enum(['get', 'create', 'set'])
      .default('get')
      .describe('Operation to perform.'),
    comp: selector
      .optional()
      .describe('Composition id or name. Defaults to the active composition.'),
    layer: selector
      .optional()
      .describe('Shape layer uid ("L123") or name for get/set. Defaults to the first selected layer.'),
    name: z.string().optional().describe('Layer name.'),
    shape: z
      .enum(['rect', 'ellipse', 'star', 'polygon', 'path'])
      .optional()
      .describe('Shape primitive for action="create" (default "rect").'),
    size: z
      .array(z.number().positive())
      .length(2)
      .optional()
      .describe('[width, height] for rect or ellipse.'),
    radius: z.number().positive().optional().describe('Outer radius for star or polygon.'),
    innerRadius: z.number().positive().optional().describe('Inner radius for star.'),
    roundness: z.number().min(0).optional().describe('Corner roundness for rect.'),
    points: z
      .union([z.number().int().min(3), z.array(z.array(z.number()).length(2)).min(2)])
      .optional()
      .describe('Point count for star/polygon, or [[x, y], ...] vertices for shape="path".'),
    closed: z.boolean().optional().describe('Whether a custom path is closed (default true).'),
    color: colorSchema.optional().describe('Fill color as "#rrggbb" or [r, g, b].'),
    fill: z.boolean().optional().describe('Enable or disable fill.'),
    strokeColor: colorSchema.optional().describe('Stroke color as "#rrggbb" or [r, g, b].'),
    stroke: z.boolean().optional().describe('Enable or disable stroke.'),
    strokeWidth: z.number().min(0).optional().describe('Stroke width in pixels.'),
    position: z
      .array(z.number())
      .min(2)
      .max(3)
      .optional()
      .describe('Layer [x, y] or [x, y, z] position.'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call('shape', args);
    return textResult(data);
  },
};
