import { z } from 'zod';
import { OffhandError } from '../../shared/errors.js';
import { capText, textResult } from './result.js';
import type { ToolDefinition } from './types.js';

interface BlockedPattern {
  pattern: RegExp;
  reason: string;
}

const BLOCKED_PATTERNS: BlockedPattern[] = [
  {
    pattern: /\bsystem\s*\.\s*callSystem\b|\bcallSystem\s*\(/i,
    reason: 'Shell command execution (system.callSystem) is blocked.',
  },
  {
    pattern: /\bExternalObject\b/,
    reason: 'Loading native libraries (ExternalObject) is blocked.',
  },
  {
    pattern: /\bSocket\b/,
    reason: 'Raw network sockets (Socket) are blocked.',
  },
  {
    pattern: /\bBridgeTalk\b/,
    reason: 'Cross-application scripting (BridgeTalk) is blocked.',
  },
  {
    pattern: /\.\s*execute\s*\(/,
    reason: 'Launching external files or executables (.execute()) is blocked.',
  },
  {
    pattern: /\$\s*\.\s*evalFile\s*\(/,
    reason: 'Loading external scripts ($.evalFile) is blocked.',
  },
  {
    pattern: /\$\s*\.\s*setenv\s*\(/,
    reason: 'Modifying environment variables ($.setenv) is blocked.',
  },
  {
    pattern: /\bapp\s*\.\s*(?:exit|quit)\s*\(/,
    reason: 'Terminating After Effects (app.exit/app.quit) is blocked.',
  },
  {
    pattern: /\bapp\s*\.\s*project\s*\.\s*close\s*\(/,
    reason: 'Closing the active project (app.project.close) is blocked.',
  },
  {
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(/,
    reason: 'Dynamic code evaluation (eval / new Function) is blocked.',
  },
  {
    pattern: /\.\s*open\s*\(\s*['"][wae]/i,
    reason: 'Writing or modifying files on disk (.open("w"|"a"|"e")) is blocked.',
  },
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\r\n]*/g, ' ');
}

export function validateExecuteScript(script: string): void {
  const cleaned = stripComments(script);

  for (const rule of BLOCKED_PATTERNS) {
    if (rule.pattern.test(cleaned)) {
      throw new OffhandError('INVALID_ARGS', `Blocked unsafe script: ${rule.reason}`, {
        hint: 'Use typed tools (comp, layer, property, effect, text, shape, mask, render, assets, view) instead of system/file/eval APIs.',
      });
    }
  }
}

export const executeTool: ToolDefinition = {
  name: 'execute',
  title: 'Run ExtendScript',
  description:
    'LAST RESORT. Run raw ExtendScript inside After Effects. Use only when no typed tool covers the task; it can do anything to the open project. Write tools run inside an undo group. The call is logged with your reason. Prefer comp, layer, property, effect, text, shape, mask, render, and assets.',
  inputSchema: {
    script: z
      .string()
      .min(1)
      .max(200_000)
      .describe('ExtendScript source. Return a JSON-serializable value for the result.'),
    reason: z
      .string()
      .min(5)
      .max(500)
      .describe('Why the typed tools cannot do this. Logged so missing tools can be added.'),
    timeout_ms: z
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(30_000)
      .describe('How long to wait for the script to finish, in milliseconds.'),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    validateExecuteScript(args.script);

    const data = await context.bridge.call(
      'execute',
      { script: args.script, reason: args.reason },
      { timeoutMs: args.timeout_ms },
    );

    if (
      data &&
      typeof data === 'object' &&
      'result' in data &&
      typeof (data as { result: unknown }).result === 'string'
    ) {
      return textResult({
        ...data,
        result: capText((data as { result: string }).result),
      });
    }

    return textResult(data);
  },
};
