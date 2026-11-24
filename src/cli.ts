import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { main } from './server/server.js';
import { doctor, packageRoot } from './server/doctor.js';
import { VERSION } from './shared/version.js';

const args = process.argv.slice(2);
const command = args[0];

if (command === '--version' || command === '-v' || command === 'version') {
  process.stdout.write(`${VERSION}\n`);
} else if (command === 'doctor') {
  process.stdout.write(`${JSON.stringify(doctor(), null, 2)}\n`);
} else if (command === 'install') {
  install(args.slice(1));
} else if (command === '--help' || command === '-h' || command === 'help') {
  process.stdout.write(helpText());
} else {
  await main();
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
  offhand --version       Print the version.

Environment:
  OFFHAND_PORT            Fixed bridge port. Default: random free port.
  OFFHAND_HOME            Override the offhand data directory.

MCP client config (example):
  {
    "mcp": {
      "offhand": {
        "type": "local",
        "command": ["npx", "-y", "offhand-mcp"],
        "enabled": true
      }
    }
  }
`;
}
