import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logPath, ensureAppDirs } from '../src/shared/paths.js';
import { readExecutePatterns, suggestTool } from '../src/server/log.js';

describe('execute patterns', () => {
  let home: string;
  const previous = process.env.OFFHAND_HOME;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'offhand-patterns-'));
    process.env.OFFHAND_HOME = home;
    ensureAppDirs();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.OFFHAND_HOME;
    else process.env.OFFHAND_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  });

  function record(tool: string, args: unknown, extra: Record<string, unknown> = {}): string {
    return `${JSON.stringify({ ts: '2026-11-25T10:00:00.000Z', tool, ok: true, ms: 12, args, ...extra })}\n`;
  }

  it('returns nothing when the log is missing', () => {
    expect(readExecutePatterns()).toEqual([]);
  });

  it('groups execute calls by reason and ignores other tools', () => {
    fs.writeFileSync(
      logPath(),
      record('status', {}) +
        record('execute', { reason: 'Set the position keyframe' }) +
        record('execute', { reason: '  set the   POSITION keyframe ' }) +
        record('execute', { reason: 'Render a preview png' }, { ok: false, errorCode: 'JSX_ERROR' }),
      'utf8',
    );

    const patterns = readExecutePatterns();
    expect(patterns).toHaveLength(2);
    expect(patterns[0]).toMatchObject({
      reason: 'Set the position keyframe',
      count: 2,
      suggestedTool: 'property',
    });
    expect(patterns[1]).toMatchObject({
      count: 1,
      suggestedTool: 'render',
      errorCodes: { JSX_ERROR: 1 },
    });
  });

  it('survives a corrupt line', () => {
    fs.writeFileSync(logPath(), `not json\n${record('execute', { reason: 'add a glow effect' })}`, 'utf8');
    expect(readExecutePatterns()[0]).toMatchObject({ count: 1, suggestedTool: 'effect' });
  });

  it('suggests a tool for common work and nothing for unknown work', () => {
    expect(suggestTool('trim the layer in point to 2s')).toBe('layer');
    expect(suggestTool('import the logo footage')).toBe('assets');
    expect(suggestTool('do something exotic')).toBeNull();
  });
});
