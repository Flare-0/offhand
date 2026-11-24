import { docsTool } from './docs.js';
import { executeTool } from './execute.js';
import { statusTool } from './status.js';
import type { ToolDefinition } from './types.js';

export const TOOLS: ToolDefinition[] = [statusTool, docsTool, executeTool];
