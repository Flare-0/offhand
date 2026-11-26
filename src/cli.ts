import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { main } from './server/server.js';
import { doctor, packageRoot } from './server/doctor.js';
import { readExecutePatterns } from './server/log.js';
import { VERSION } from './shared/version.js';

const args = process.argv.slice(2);
const command = args[0];

if (command === '--version' || command === '-v' || command === 'version') {
  process.stdout.write(`${VERSION}\n`);
} else if (command === 'doctor') {
  process.stdout.write(`${JSON.stringify(doctor(), null, 2)}\n`);
} else if (command === 'patterns') {
  patterns();
} else if (command === 'install') {
  install(args.slice(1));
} else if (command === '--help' || command === '-h' || command === 'help') {
  process.stdout.write(helpText());
} else {
  await main();
}

function patterns(): void {
  const found = readExecutePatterns(Number(args[1]) || 20);
  if (found.length === 0) {
    process.stdout.write(
      'No `execute` calls logged yet.\nThe log lives at %APPDATA%\\offhand\\logs\\usage.jsonl.\n',
    );
    return;
  }

  process.stdout.write('execute patterns (most repeated first)\n\n');
  for (const pattern of found) {
    const when = pattern.lastAt ? pattern.lastAt.slice(0, 10) : 'unknown';
    process.stdout.write(`  ${String(pattern.count).padStart(3)}x  ${pattern.reason}\n`);
    process.stdout.write(`        last ${when}`);
    const codes = Object.keys(pattern.errorCodes);
    if (codes.length > 0) {
      process.stdout.write(
        `  errors: ${codes.map((code) => `${code}×${pattern.errorCodes[code]}`).join(', ')}`,
      );
    }
    process.stdout.write('\n');
    if (pattern.suggestedTool) {
      process.stdout.write(`        candidate typed tool: ${pattern.suggestedTool}\n`);
    }
    process.stdout.write('\n');
  }
  process.stdout.write(
    'A pattern seen twice or more is a candidate for a typed tool: add the schema in\n' +
      'src/server/tools, the handler in extension/src/jsx/tools, then keep `execute` for the rest.\n',
  );
}

function install(extraArgs: string[]): never {
  const script = path.join(packageRoot(), 'scripts', 'install-cep.mjs');
  const result = spawnSync(process.execPath, [script, ...extraArgs], {
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

function helpText(): string {
  return `offhand ${VERSION} — After Effects, at hand.

Usage:
  offhand                 Start the MCP server on stdio.
  offhand install [--link] Install the CEP panel into After Effects.
  offhand doctor          Print paths, bridge state, and AE installs.
  offhand patterns [n]    Show repeated "execute" reasons (typed-tool candidates).
  offhand --version       Print the version.

The After Effects panel hosts the bridge: it listens on 127.0.0.1, publishes
%APPDATA%\\offhand\\bridge.json, and this server dials in. Nothing listens here,
so several MCP clients can connect at once.

Environment:
  OFFHAND_HOME            Override the offhand data directory.

MCP client config (example):
  {
    "mcp": {
      "offhand": {
        "type": "local",
        "command": ["node", "C:/path/to/offhand/dist/cli.js"],
        "enabled": true
      }
    }
  }
`;
}
