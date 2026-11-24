import type { z } from 'zod';
import type { Bridge } from '../bridge.js';

export interface ToolContext {
  bridge: Bridge;
}

export interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations?: ToolAnnotations;
  handler: (args: any, context: ToolContext) => Promise<ToolTextResult>;
}
