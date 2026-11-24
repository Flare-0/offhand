import fs from 'node:fs';
import { ensureAppDirs, logPath } from '../shared/paths.js';

export interface UsageRecord {
  tool: string;
  ok: boolean;
  ms: number;
  args?: unknown;
  errorCode?: string;
}

export function summarizeArgs(args: unknown): unknown {
  if (args === null || typeof args !== 'object') return args;
  const record = { ...(args as Record<string, unknown>) };

  if (typeof record.script === 'string') {
    record.script = `<${record.script.length} chars>`;
  }

  const serialized = JSON.stringify(record);
  if (serialized.length > 800) {
    return { truncated: true, preview: `${serialized.slice(0, 800)}…` };
  }
  return record;
}

export function logUsage(record: UsageRecord): void {
  try {
    ensureAppDirs();
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...record,
    });
    fs.appendFileSync(logPath(), `${line}\n`, 'utf8');
  } catch {
    // Usage logging must never break a tool call.
  }
}

export function logInfo(message: string): void {
  process.stderr.write(`[offhand] ${message}\n`);
}
