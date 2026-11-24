import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const selector = z.union([z.number(), z.string()]);

export const propertyTool: ToolDefinition = {
  name: 'property',
  title: 'Property & Keyframes',
  description:
    'Read, set, keyframe, or attach expressions to any layer property by dot path (e.g. "transform.position", "transform.opacity", "effects.Glow.Glow Threshold").',
  inputSchema: {
    action: z
      .enum(['list', 'get', 'set', 'keyframe', 'expression', 'removeKeyframe'])
      .default('get')
      .describe('Operation to perform.'),
    comp: selector
      .optional()
      .describe('Composition id or name. Defaults to the active composition.'),
    layer: selector
      .optional()
      .describe('Layer index or name. Defaults to the first selected layer.'),
    path: z
      .string()
      .optional()
      .describe('Dot-separated property path, e.g. "transform.position". Optional for action="list" (lists root groups).'),
    value: z
      .unknown()
      .optional()
      .describe('Value to set (number, [x, y], [x, y, z], "#rrggbb", or shape/text object).'),
    time: z
      .number()
      .optional()
      .describe('Time in seconds for keyframing. Defaults to comp.time for action="keyframe".'),
    ease: z
      .enum(['linear', 'easeIn', 'easeOut', 'easeInOut'])
      .optional()
      .describe('Optional temporal interpolation/easing to apply when adding a keyframe.'),
    expression: z
      .string()
      .optional()
      .describe('ExtendScript expression string for action="expression". Pass "" to clear.'),
    enabled: z
      .boolean()
      .optional()
      .describe('Enable or disable the expression for action="expression".'),
    keyIndex: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('1-based keyframe index for action="removeKeyframe".'),
    includeKeys: z
      .boolean()
      .optional()
      .describe('Include keyframe list in action="get" output (default true).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Maximum child properties for action="list".'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call('property', args);
    return textResult(data);
  },
};
