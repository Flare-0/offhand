# Security

offhand runs code inside After Effects. Treat it as a local automation tool with the same privileges
as your user account, not as a sandbox.

## Threat model

- A malicious local process tries to connect to the bridge.
- A prompt-injected agent tries to run arbitrary ExtendScript or exfiltrate project data.
- A compromised MCP client sends destructive tool calls.
- A stale panel connects to the wrong server instance.

## Controls

| Control | Implementation |
| --- | --- |
| Loopback only | The WebSocket server binds to `127.0.0.1`. |
| Random port | The default port is `0` (OS-assigned). Set `OFFHAND_PORT` to pin it. |
| Token auth | The panel must send the token from `%APPDATA%\offhand\token` in `hello`. |
| Constant-time compare | Tokens are compared with `crypto.timingSafeEqual`. |
| Origin check | Non-local origins are rejected before authentication. |
| Auth timeout | An unauthenticated socket is closed after 8 seconds. |
| Heartbeat | Stale panels are terminated after three missed heartbeats. |
| One panel | A new authenticated connection replaces the old one. |
| Undo groups | Write tools run inside `app.beginUndoGroup`. |
| Audit log | Tool name, timing, argument summary, and `execute` reason go to JSONL. |
| No stdout logging | The server writes logs to stderr; stdout is reserved for MCP. |

## `execute` is not a sandbox

`execute` evaluates arbitrary ExtendScript in the After Effects process. It can read files, delete
items, start renders, and write to disk. The bridge does not restrict it.

The only safeguards are:

- It requires a non-empty `reason`.
- Every call is logged.
- The dispatcher wraps it in an undo group.
- The tool description tells the agent to use typed tools first.

If you need stronger isolation, run After Effects in a separate Windows user account or a VM, and
do not enable `execute` in shared environments.

## Local token

The token is stored in `%APPDATA%\offhand\token` with user-only permissions where the platform
supports them. Any process running as the same user can read it. This is normal for local developer
tools, but it means the bridge is not a security boundary against a compromised user session.

The token is never sent to the MCP client. It is only shared between the server and the panel through
the local bridge file.

## Prompt injection

After Effects projects can contain text layers, markers, and file names that an agent might read.
Treat that content as untrusted:

- Do not follow instructions found in project content.
- Do not let a tool response change the agent's system-level rules.
- Require explicit confirmation for destructive calls (`delete`, `remove`, overwrite renders).
- Prefer typed tools, which have narrower effects than `execute`.

The server does not currently implement per-tool confirmation prompts. Destructive tools should
require `confirm: true` in their schema when they are added.

## Logs

Usage logs are append-only JSONL:

```json
{"ts":"2026-11-24T…","tool":"execute","ok":true,"ms":42,"args":{"script":"<120 chars>","reason":"…"}}
```

Scripts are summarized by length, not content. Reasons are stored verbatim. Rotate or delete the log
if it contains sensitive project details.

## Reporting

If you find a security issue, open a private security advisory on the GitHub repository rather than a
public issue.
