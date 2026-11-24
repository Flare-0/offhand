import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'dist', 'cli.js');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'offhand-smoke-'));

if (!fs.existsSync(entry)) {
  console.error(`Missing ${entry}. Run "npm run build" first.`);
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env: { ...process.env, OFFHAND_HOME: home },
  stderr: 'pipe',
});

const client = new Client({ name: 'offhand-smoke', version: '0.0.0' });

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  console.log(`tools: ${names.join(', ')}`);

  for (const required of ['docs', 'execute', 'status']) {
    if (!names.includes(required)) throw new Error(`Missing tool: ${required}`);
  }

  const docs = await client.callTool({
    name: 'docs',
    arguments: { action: 'search', query: 'save frame png' },
  });
  const docsText = docs.content?.[0]?.type === 'text' ? docs.content[0].text : '';
  if (!docsText.includes('comp.saveFrameToPng')) {
    throw new Error(`docs search did not find saveFrameToPng: ${docsText.slice(0, 200)}`);
  }
  console.log('docs: ok');

  const status = await client.callTool({ name: 'status', arguments: {} });
  const statusText = status.content?.[0]?.type === 'text' ? status.content[0].text : '';
  const parsed = JSON.parse(statusText);
  if (parsed.connected !== false) {
    throw new Error(`status should report disconnected without AE: ${statusText.slice(0, 200)}`);
  }
  console.log('status: offline handled');

  await client.close();
  console.log('smoke: ok');
} finally {
  try {
    await client.close();
  } catch {
    // Already closed.
  }
  fs.rmSync(home, { recursive: true, force: true });
}
