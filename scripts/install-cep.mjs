#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// bolt-cep builds the extension into extension/dist/cep — that folder *is* the
// CEP extension root (CSXS/manifest.xml, main/, assets/, jsx/, node_modules/).
const source = path.join(root, 'extension', 'dist', 'cep');
const userData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
const extensionsDir = path.join(userData, 'Adobe', 'CEP', 'extensions');
const target = path.join(extensionsDir, 'com.offhand.panel');

const flags = new Set(process.argv.slice(2));
const link = flags.has('--link');
const uninstall = flags.has('--uninstall');

if (uninstall) {
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${target}`);
  console.log('Restart After Effects to unload the panel.');
  process.exit(0);
}

if (!fs.existsSync(path.join(source, 'CSXS', 'manifest.xml'))) {
  console.error(`offhand: built extension not found at ${source}`);
  console.error('offhand: run `npm run build:extension` first, then retry.');
  process.exit(1);
}

fs.mkdirSync(extensionsDir, { recursive: true });
fs.rmSync(target, { recursive: true, force: true });

if (link) {
  fs.symlinkSync(source, target, 'junction');
  console.log(`Linked ${target}`);
  console.log(`         -> ${source}`);
  console.log('Keep the repository in place while using the linked panel.');
} else {
  fs.cpSync(source, target, { recursive: true });
  console.log(`Installed ${target}`);
}

enablePlayerDebugMode();

console.log('');
console.log('Next:');
console.log('  1. Restart After Effects.');
console.log('  2. Open Window > Extensions > offhand.');
console.log('  3. Start the MCP server in your client (npx -y offhand-mcp).');
console.log('');
console.log('The panel and the MCP server discover each other through %APPDATA%\\offhand.');

function enablePlayerDebugMode() {
  if (process.platform !== 'win32') {
    console.log('');
    console.log('Non-Windows host: unsigned CEP panels need the platform-specific debug setting.');
    return;
  }

  for (const version of ['9', '10', '11', '12', '13']) {
    try {
      execFileSync(
        'reg',
        [
          'add',
          `HKCU\\Software\\Adobe\\CSXS.${version}`,
          '/v',
          'PlayerDebugMode',
          '/t',
          'REG_SZ',
          '/d',
          '1',
          '/f',
        ],
        { stdio: 'ignore' },
      );
    } catch {
      // Older/newer CEP versions may not exist on this machine.
    }
  }
  console.log('Enabled CEP PlayerDebugMode for CSXS 9–13.');
}
