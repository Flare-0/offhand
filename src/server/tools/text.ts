import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const selector = z.union([z.number(), z.string()]);
const colorSchema = z.union([z.string(), z.array(z.number()).min(3).max(4)]);

export const textTool: ToolDefinition = {
  name: 'text',
  title: 'Text Layer',
  description:
    'Create, read, or style a text layer (text content, font, size, fill/stroke color, tracking, leading, justification).',
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
      .describe('Text layer uid ("L123") or name for get/set. Defaults to the first selected layer.'),
    name: z.string().optional().describe('Layer name.'),
    text: z.string().optional().describe('Text string content.'),
    font: z.string().optional().describe('PostScript font name, e.g. "Arial-BoldMT".'),
    size: z.number().positive().optional().describe('Font size in points.'),
    color: colorSchema.optional().describe('Fill color as "#rrggbb" or [r, g, b].'),
    fill: z.boolean().optional().describe('Enable or disable text fill.'),
    strokeColor: colorSchema.optional().describe('Stroke color as "#rrggbb" or [r, g, b].'),
    stroke: z.boolean().optional().describe('Enable or disable text stroke.'),
    strokeWidth: z.number().min(0).optional().describe('Stroke width in pixels.'),
    tracking: z.number().optional().describe('Character tracking.'),
    leading: z.number().min(0).optional().describe('Line leading.'),
    justification: z
      .enum(['left', 'center', 'right', 'justify'])
      .optional()
      .describe('Paragraph justification.'),
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
    const data = await context.bridge.call('text', args);
    return textResult(data);
  },
};
