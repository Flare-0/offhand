import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const selector = z.union([z.number(), z.string()]);
const colorSchema = z.union([z.string(), z.array(z.number()).min(3).max(4)]);

export const compTool: ToolDefinition = {
  name: 'comp',
  title: 'Composition',
  description:
    'List compositions, inspect a composition, create a new composition, or update composition settings (dimensions, fps, duration, work area, background color).',
  inputSchema: {
    action: z
      .enum(['list', 'get', 'create', 'set'])
      .default('list')
      .describe('Operation to perform.'),
    comp: selector
      .optional()
      .describe('Composition id or name. Defaults to the active composition.'),
    name: z.string().min(1).optional().describe('Composition name.'),
    width: z.number().int().min(1).max(30000).optional().describe('Width in pixels.'),
    height: z.number().int().min(1).max(30000).optional().describe('Height in pixels.'),
    fps: z.number().positive().max(240).optional().describe('Frame rate in frames per second.'),
    duration: z.number().positive().optional().describe('Duration in seconds.'),
    pixelAspect: z.number().positive().optional().describe('Pixel aspect ratio (default 1).'),
    bg: colorSchema.optional().describe('Background color as "#rrggbb" or [r, g, b].'),
    open: z.boolean().optional().describe('Open newly created composition in viewer (default true).'),
    workAreaStart: z.number().min(0).optional().describe('Work area start in seconds.'),
    workAreaDuration: z.number().positive().optional().describe('Work area duration in seconds.'),
    resolutionFactor: z
      .union([z.number().int().min(1), z.array(z.number().int().min(1)).length(2)])
      .optional()
      .describe('Preview downsample factor, e.g. 1 (full), 2 (half), or [x, y].'),
    motionBlur: z.boolean().optional().describe('Enable composition motion blur.'),
    shutterAngle: z.number().min(0).max(720).optional().describe('Shutter angle in degrees.'),
    limit: z.number().int().min(1).max(200).optional().describe('Maximum items for action="list".'),
    offset: z.number().int().min(0).optional().describe('Pagination offset for action="list".'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call('comp', args);
    return textResult(data);
  },
};
