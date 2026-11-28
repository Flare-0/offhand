import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Version drift has bitten us once: the panel reported 0.1.0 while the rest of
// the project was on 0.2.0, because PANEL_VERSION is a literal in the panel
// bundle (it cannot import src/shared). These tests keep the three copies in
// step without adding a build-time read of package.json inside CEP.
const root = path.resolve(__dirname, '..');

const readJson = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as { version: string };

const readText = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('version consistency', () => {
  const rootVersion = readJson('package.json').version;
  const extensionVersion = readJson('extension/package.json').version;

  it('root and extension package versions match', () => {
    expect(extensionVersion).toBe(rootVersion);
  });

  it('PANEL_VERSION matches extension/package.json', () => {
    const config = readText('extension/src/js/bridge/config.ts');
    const match = config.match(/PANEL_VERSION\s*=\s*"([^"]+)"/);
    expect(match?.[1]).toBe(extensionVersion);
  });

  it('host Offhand.version matches extension/package.json', () => {
    const state = readText('extension/src/jsx/core/state.ts');
    const match = state.match(/version:\s*"([^"]+)"/);
    expect(match?.[1]).toBe(extensionVersion);
  });

  it('server VERSION matches package.json', () => {
    const shared = readText('src/shared/version.ts');
    const match = shared.match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
    expect(match?.[1]).toBe(rootVersion);
  });
});
