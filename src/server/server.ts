import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SERVER_NAME, VERSION } from '../shared/version.js';
import { Bridge } from './bridge.js';
import { logInfo, logUsage, summarizeArgs } from './log.js';
import { TOOLS } from './tools/registry.js';
import { errorResult } from './tools/result.js';

export async function main(): Promise<void> {
  const bridge = new Bridge({ port: parsePort(process.env.OFFHAND_PORT) });
  await bridge.start();

  const server = new McpServer({ name: SERVER_NAME, version: VERSION });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema as any,
        ...(tool.annotations ? { annotations: tool.annotations as any } : {}),
      },
      async (args: any) => {
        const startedAt = Date.now();
        try {
          const result = await tool.handler(args, { bridge });
          logUsage({
            tool: tool.name,
            ok: !result.isError,
            ms: Date.now() - startedAt,
            args: summarizeArgs(args),
            ...(result.isError ? { errorCode: 'TOOL_ERROR' } : {}),
          });
          return result as any;
        } catch (error) {
          const result = errorResult(error);
          logUsage({
            tool: tool.name,
            ok: false,
            ms: Date.now() - startedAt,
            args: summarizeArgs(args),
            errorCode: 'TOOL_EXCEPTION',
          });
          return result as any;
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logInfo(`${SERVER_NAME} ${VERSION} ready on stdio`);

  let stopping = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logInfo(`shutting down (${reason})`);
    try {
      await server.close();
    } catch {
      // The transport may already be closed.
    }
    try {
      await bridge.stop();
    } catch {
      // Best-effort cleanup.
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.stdin.on('close', () => void shutdown('stdin closed'));
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`OFFHAND_PORT must be a port between 0 and 65535, received "${value}".`);
  }
  return parsed;
}
