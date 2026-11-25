import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appDataDir,
  bridgeConfigPath,
  readBridgeConfigFile,
  tokenPath,
} from '../shared/paths.js';
import { PROTOCOL_VERSION, VERSION } from '../shared/version.js';

export function packageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const parent = path.resolve(here, '..');
  if (fs.existsSync(path.join(parent, 'package.json'))) return parent;
  return path.resolve(here, '..', '..');
}

function userData(): string {
  return process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming');
}

function existingDirectories(paths: string[]): string[] {
  return paths.filter((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
}

function findAfterEffectsInstalls(): string[] {
  const roots = [
    'C:\\Program Files\\Adobe',
    'C:\\Program Files (x86)\\Adobe',
    'D:\\Program Files\\Adobe',
    'E:\\Apps\\AdobeApps',
  ];

  const installs: string[] = [];
  for (const root of roots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!/after\s*effects/i.test(entry.name)) continue;
      installs.push(path.join(root, entry.name));
    }
  }

  return [...new Set(installs)].sort();
}

export interface DoctorReport {
  offhandVersion: string;
  protocolVersion: number;
  platform: string;
  node: string;
  appDataDir: string;
  bridgeConfigPath: string;
  /** 'ok' when a v2 bridge.json exists, otherwise why it cannot be used. */
  bridgeConfigState: 'ok' | 'missing' | 'legacy' | 'malformed';
  bridgeConfigVersion: number | null;
  bridgeConfig: unknown;
  bridgeConfigError: string | null;
  tokenPresent: boolean;
  packageRoot: string;
  extensionSource: string;
  extensionInstalled: boolean;
  cepExtensionFolders: string[];
  afterEffectsInstalls: string[];
}

export function doctor(): DoctorReport {
  const root = packageRoot();
  const cepFolders = existingDirectories([
    path.join(userData(), 'Adobe', 'CEP', 'extensions'),
    'C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions',
    'C:\\Program Files\\Common Files\\Adobe\\CEP\\extensions',
  ]);
  const bridge = readBridgeConfigFile();

  return {
    offhandVersion: VERSION,
    protocolVersion: PROTOCOL_VERSION,
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    appDataDir: appDataDir(),
    bridgeConfigPath: bridgeConfigPath(),
    bridgeConfigState: bridge.status,
    bridgeConfigVersion: bridge.status === 'legacy' ? bridge.version : bridge.status === 'ok' ? bridge.config.version : null,
    bridgeConfig: bridge.status === 'ok' ? bridge.config : null,
    bridgeConfigError: bridge.status === 'malformed' ? bridge.error : null,
    tokenPresent: fs.existsSync(tokenPath()),
    packageRoot: root,
    extensionSource: path.join(root, 'extension', 'dist', 'cep'),
    extensionInstalled: fs.existsSync(
      path.join(userData(), 'Adobe', 'CEP', 'extensions', 'com.offhand.panel'),
    ),
    cepExtensionFolders: cepFolders,
    afterEffectsInstalls: findAfterEffectsInstalls(),
  };
}
