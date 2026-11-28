import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderTool } from '../src/server/tools/render.js';
import type { ToolContext } from '../src/server/tools/types.js';

const payload = (result: { content: Array<{ text: string }> }) =>
  JSON.parse(result.content[0]!.text) as Record<string, any>;

const context = (
  call: (...args: unknown[]) => Promise<unknown>,
  state = 'ready',
) =>
  ({ bridge: { call, status: () => ({ state }) } }) as unknown as ToolContext;

describe('render status cache', () => {
  it('answers jobs from the marker while AE renders, then syncs once done', async () => {
    const marker = join(mkdtempSync(join(tmpdir(), 'offhand-render-cache-')), 'render.status');
    writeFileSync(marker, 'rendering');

    const call = vi.fn().mockResolvedValue({
      scheduled: true,
      statusFile: marker,
      rendering: false,
      total: 1,
      jobs: [{ id: 'j1', status: 'rendering' }],
    });
    const started = payload(await renderTool.handler({ action: 'start' }, context(call)));
    expect(call).toHaveBeenCalledTimes(1);
    expect(started.statusFile).toBeUndefined();
    expect(started.scheduled).toBe(true);

    const cachedCall = vi.fn().mockRejectedValue(new Error('bridge must not be called'));
    const cached = payload(
      await renderTool.handler({ action: 'jobs' }, context(cachedCall)),
    );
    expect(cachedCall).not.toHaveBeenCalled();
    expect(cached.rendering).toBe(true);
    expect(cached.jobs[0].status).toBe('rendering');
    expect(cached.note).toContain('still rendering');

    writeFileSync(marker, 'done');
    const finalCall = vi.fn().mockResolvedValue({
      rendering: false,
      total: 1,
      jobs: [{ id: 'j1', status: 'done' }],
    });
    const synced = payload(
      await renderTool.handler({ action: 'jobs' }, context(finalCall)),
    );
    expect(finalCall).toHaveBeenCalledTimes(1);
    expect(synced.jobs[0].status).toBe('done');
  });

  it('does not return a stale cache when the marker disappears', async () => {
    const marker = join(mkdtempSync(join(tmpdir(), 'offhand-render-cache-')), 'render.status');
    writeFileSync(marker, 'rendering');

    const startCall = vi.fn().mockResolvedValue({
      scheduled: true,
      statusFile: marker,
      rendering: false,
      total: 1,
      jobs: [],
    });
    await renderTool.handler({ action: 'start' }, context(startCall));

    unlinkSync(marker);
    const finalCall = vi.fn().mockResolvedValue({ rendering: false, total: 0, jobs: [] });
    await renderTool.handler({ action: 'status' }, context(finalCall));
    expect(finalCall).toHaveBeenCalledTimes(1);
  });

  it('does not use the cached marker when the bridge is not ready', async () => {
    const marker = join(mkdtempSync(join(tmpdir(), 'offhand-render-cache-')), 'render.status');
    writeFileSync(marker, 'rendering');

    await renderTool.handler(
      { action: 'start' },
      context(
        vi.fn().mockResolvedValue({
          scheduled: true,
          statusFile: marker,
          rendering: false,
          total: 1,
          jobs: [],
        }),
      ),
    );

    const finalCall = vi.fn().mockResolvedValue({ rendering: false, total: 0, jobs: [] });
    await renderTool.handler({ action: 'jobs' }, context(finalCall, 'degraded'));
    expect(finalCall).toHaveBeenCalledTimes(1);
  });
});
