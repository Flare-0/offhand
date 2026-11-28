import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

const selector = z.union([z.number(), z.string()]);

export const assetsTool: ToolDefinition = {
  name: 'assets',
  title: 'Project Assets',
  description:
    'List project footage/folder items, import media files, replace footage sources, create project folders, or remove project items.',
  inputSchema: {
    action: z
      .enum(['list', 'import', 'replace', 'folder', 'remove'])
      .default('list')
      .describe('Operation to perform.'),
    paths: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional()
      .describe(
        'File paths to import for action="import": one path or an array of paths.',
      ),
    path: z
      .string()
      .min(1)
      .optional()
      .describe('Single file path for action="import" or replacement file for action="replace".'),
    item: selector
      .optional()
      .describe('Project item id or name for action="replace" or action="remove".'),
    name: z
      .string()
      .min(1)
      .optional()
      .describe('Folder name for action="folder".'),
    folder: selector
      .optional()
      .describe('Destination folder id or name for action="import" or action="folder".'),
    sequence: z
      .boolean()
      .optional()
      .describe('Import numbered files as an image sequence (default false).'),
    confirm: z
      .boolean()
      .optional()
      .describe('Required true for action="remove".'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Maximum items for action="list".'),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Pagination offset for action="list".'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call('assets', args);
    return textResult(data);
  },
};
