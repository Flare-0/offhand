import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOLS } from '../src/server/tools/registry.js';

describe('tool registry', () => {
  it('registers all 14 tools with unique names', () => {
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
    ]);
    expect(new Set(names).size).toBe(TOOLS.length);
  });

  it('has a matching ExtendScript handler for every AE-bridged tool', () => {
    const hostToolsDir = resolve(process.cwd(), 'extension', 'host', 'tools');
    for (const tool of TOOLS) {
      if (tool.name === 'docs') continue;
      expect(existsSync(resolve(hostToolsDir, `${tool.name}.jsx`))).toBe(true);
    }
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

    const layerDelete = z.object(byName.get('layer')!.inputSchema);
    expect(
      layerDelete.parse({ action: 'delete', comp: 'Main', layer: 'Title', confirm: true }),
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
  });
});
