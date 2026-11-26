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

export interface ExecutePattern {
  /** First-seen wording of the reason. */
  reason: string;
  count: number;
  lastAt: string;
  errorCodes: Record<string, number>;
  /** Typed tool that would probably cover this work, if one is obvious. */
  suggestedTool: string | null;
}

const TOOL_KEYWORDS: Array<[RegExp, string]> = [
  [/\bkeyframe|easing|expression\b/i, 'property'],
  [/\bproperty|position|opacity|scale|rotation|anchor\b/i, 'property'],
  [/\blayer|precomp|solid|null object\b/i, 'layer'],
  [/\beffect|plugin|glow|blur|tint|curves\b/i, 'effect'],
  [/\btext|type|font|typography\b/i, 'text'],
  [/\bmask|matte|roto\b/i, 'mask'],
  [/\bshape|path|vector\b/i, 'shape'],
  [/\brender|output|png|queue\b/i, 'render'],
  [/\bimport|footage|asset|replace\b/i, 'assets'],
  [/\bcomp|composition|precomp\b/i, 'comp'],
  [/\bopen|view|playhead|select\b/i, 'view'],
];

/** Best guess at the typed tool that should absorb a raw-script pattern. */
export function suggestTool(reason: string): string | null {
  for (const [pattern, tool] of TOOL_KEYWORDS) {
    if (pattern.test(reason)) return tool;
  }
  return null;
}

function normalizeReason(value: unknown): string {
  if (typeof value !== 'string') return '(no reason given)';
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : '(no reason given)';
}

/**
 * Reads `usage.jsonl` and groups `execute` calls by their reason, so repeated
 * raw-script work can be promoted to a typed tool. Best-effort: a missing or
 * malformed log returns an empty list.
 */
export function readExecutePatterns(limit = 20): ExecutePattern[] {
  let text: string;
  try {
    text = fs.readFileSync(logPath(), 'utf8');
  } catch {
    return [];
  }

  const byReason = new Map<string, ExecutePattern>();
  const display = new Map<string, string>();

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (record.tool !== 'execute') continue;

    const args = (record.args ?? {}) as Record<string, unknown>;
    const reason = normalizeReason(args.reason);
    const key = reason.toLowerCase();
    if (!display.has(key)) display.set(key, reason);

    const existing = byReason.get(key) ?? {
      reason: display.get(key)!,
      count: 0,
      lastAt: '',
      errorCodes: {},
      suggestedTool: suggestTool(reason),
    };
    existing.count += 1;
    const ts = typeof record.ts === 'string' ? record.ts : '';
    if (ts > existing.lastAt) existing.lastAt = ts;
    if (typeof record.errorCode === 'string') {
      existing.errorCodes[record.errorCode] = (existing.errorCodes[record.errorCode] ?? 0) + 1;
    }
    byReason.set(key, existing);
  }

  return [...byReason.values()]
    .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
    .slice(0, limit);
}
