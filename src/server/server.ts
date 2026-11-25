import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SERVER_NAME, VERSION } from '../shared/version.js';
import { Bridge } from './bridge.js';
import { logInfo, logUsage, summarizeArgs } from './log.js';
import { TOOLS } from './tools/registry.js';
import { errorResult } from './tools/result.js';

export async function main(): Promise<void> {
  const bridge = new Bridge();

  bridge.on('online', (ae: { version?: string } | null) => {
    logInfo(`After Effects ready (AE ${ae?.version ?? 'unknown'})`);
  });
  bridge.on('offline', () => logInfo('After Effects bridge offline; retrying'));

  // The panel owns the socket, so the server boots fine with AE closed. A
  // failure here means the *server's* own state is broken — still serve stdio.
  try {
    await bridge.start();
  } catch (error) {
    logInfo(`bridge client failed to start: ${error instanceof Error ? error.message : String(error)}`);
  }

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
