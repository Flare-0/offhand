import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOLS } from '../src/server/tools/registry.js';

describe('tool registry', () => {
  it('registers all 15 tools with unique names', () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(names).toEqual([
      'status',
      'docs',
      'project',
      'comp',
      'layer',
      'property',
      'effect',
      'text',
      'shape',
      'mask',
      'render',
      'assets',
      'view',
      'execute',
      'batch',
    ]);
    expect(new Set(names).size).toBe(TOOLS.length);
  });

  it('has a matching ExtendScript handler for every AE-bridged tool', () => {
    // Phase D moved the host to TypeScript; `extension/host` is the frozen
    // legacy fallback and is no longer the source of truth.
    const hostToolsDir = resolve(process.cwd(), 'extension', 'src', 'jsx', 'tools');
    for (const tool of TOOLS) {
      if (tool.name === 'docs') continue;
      expect(existsSync(resolve(hostToolsDir, `${tool.name}.ts`))).toBe(true);
    }
  });

  it('does not let batch nest itself', () => {
    const batch = TOOLS.find((tool) => tool.name === 'batch')!;
    expect(batch.description).toContain('cannot nest batch');
  });

  it('validates input schemas with zod', () => {
    const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

    const compCreate = z.object(byName.get('comp')!.inputSchema);
    expect(
      compCreate.parse({
        action: 'create',
        name: 'Main',
        width: 1920,
        height: 1080,
        fps: 30,
        duration: 10,
      }),
    ).toMatchObject({ action: 'create', name: 'Main', width: 1920 });

    const compListFull = z.object(byName.get('comp')!.inputSchema);
    expect(compListFull.parse({ action: 'list', detail: 'full' })).toMatchObject({ detail: 'full' });
    expect(() => compListFull.parse({ action: 'list', detail: 'verbose' })).toThrow();

    const layerDelete = z.object(byName.get('layer')!.inputSchema);
    expect(
      layerDelete.parse({ action: 'delete', comp: 'Main', layer: '#42', confirm: true }),
    ).toMatchObject({ action: 'delete', confirm: true });

    const propKeyframe = z.object(byName.get('property')!.inputSchema);
    expect(() => propKeyframe.parse({ action: 'invalid' })).toThrow();

    const maskCreate = z.object(byName.get('mask')!.inputSchema);
    expect(
      maskCreate.parse({
        action: 'create',
        shape: 'rect',
        bounds: [0, 0, 1920, 1080],
        mode: 'add',
        feather: 12,
      }),
    ).toMatchObject({ action: 'create', mode: 'add', feather: 12 });

    const renderStart = z.object(byName.get('render')!.inputSchema);
    expect(renderStart.parse({ action: 'start' })).toMatchObject({ action: 'start' });
    expect(renderStart.parse({ action: 'jobs' })).toMatchObject({ action: 'jobs' });

    const batch = z.object(byName.get('batch')!.inputSchema);
    expect(
      batch.parse({ calls: [{ tool: 'status' }, { tool: 'comp', args: { action: 'list' } }] }),
    ).toMatchObject({ stopOnError: true });
    expect(() => batch.parse({ calls: [] })).toThrow();
    expect(() =>
      batch.parse({ calls: Array.from({ length: 21 }, () => ({ tool: 'status' })) }),
    ).toThrow();
  });
});
