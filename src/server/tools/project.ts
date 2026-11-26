import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const detailSchema = z
  .enum(['min', 'full'])
  .optional()
  .describe('Response detail: min (ids and essentials, default) or full (every field).');

export const projectTool: ToolDefinition = {
  name: 'project',
  title: 'Project',
  description:
    'Inspect or manage the open After Effects project: get project summary, list compositions or project items, open a .aep file, or save the project.',
  inputSchema: {
    action: z
      .enum(['info', 'comps', 'items', 'open', 'save'])
      .default('info')
      .describe('Operation to perform on the project.'),
    detail: detailSchema,
    kind: z
      .enum(['comp', 'footage', 'folder'])
      .optional()
      .describe('Filter for action="items".'),
    path: z
      .string()
      .min(1)
      .optional()
      .describe('File path for action="open" or Save As for action="save".'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Maximum number of items to return for comps/items.'),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Pagination offset for comps/items.'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call('project', args);
    return textResult(data);
  },
};
