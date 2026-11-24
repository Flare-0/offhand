import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

export const statusTool: ToolDefinition = {
  name: 'status',
  title: 'offhand status',
  description:
    'Check whether After Effects is connected and read the current project, active composition, playhead, and selection. Read-only. Call this first when you are unsure about the state.',
  inputSchema: {},
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(_args, context) {
    const bridge = context.bridge.status();

    if (!bridge.online) {
      return textResult({
        connected: false,
        bridge: {
          host: bridge.host,
          port: bridge.port,
        },
        hint: 'Open After Effects, then choose Window > Extensions > offhand. The panel reconnects automatically.',
      });
    }

    const data = await context.bridge.call('status', {});
    return textResult({
      connected: true,
      bridge: {
        panelVersion: bridge.panelVersion,
        connectedAt: bridge.connectedAt,
      },
      afterEffects: data,
    });
  },
};
