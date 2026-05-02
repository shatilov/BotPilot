# Codex CLI Notes

This document records the Codex CLI behavior relevant to Assyst Daemon. It was checked against the locally installed `codex` CLI on 2026-05-02.

## Commands

Run a non-interactive task:

```bash
codex exec [OPTIONS] [PROMPT]
```

Resume a previous non-interactive session:

```bash
codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]
```

Use stdin for the resumed prompt:

```bash
codex exec resume <session-id> -
```

Useful options for this project:

```bash
-C, --cd <DIR>                  workspace root
-m, --model <MODEL>             model override
-s, --sandbox <MODE>            read-only | workspace-write | danger-full-access
-a, --ask-for-approval <POLICY> untrusted | on-request | never
--skip-git-repo-check           allow non-git workspaces
--json                          print events as JSONL
-o, --output-last-message <FILE> write final agent message to file
```

## One Master Dialog

Assyst Daemon should not call plain `codex exec` for every chat message. That creates independent Codex sessions.

The desired model is:

1. First user message creates a Codex session.
2. The daemon persists that session id as the master dialog id.
3. Every later user message calls `codex exec resume <session-id> -`.

Do not use `codex exec resume --last` in daemon logic. It is useful manually, but a background daemon needs deterministic routing to the stored master dialog.

## Open Implementation Question

The next implementation step is to capture the created Codex session id reliably after the first `codex exec` run. Candidate approaches:

- parse `--json` event output if it exposes the session id;
- inspect Codex session index/state files after the run;
- require an explicit session id only after a manual bootstrap.

The preferred path is `--json` if the event stream contains the id, because it keeps the daemon coupled to CLI output rather than private state files.

## MCP Server Mode

Codex also exposes a stdio MCP server:

```bash
codex mcp-server
```

Verified locally with `codex-cli 0.125.0`:

- the server advertises itself as `codex-mcp-server`;
- the stdio transport in this build accepts newline-delimited JSON-RPC messages;
- it exposes two tools:
  - `codex`: starts a Codex conversation and returns structured `{ threadId, content }`;
  - `codex-reply`: continues an existing MCP-server conversation with `{ threadId, prompt }`.

The `codex` tool accepts agent configuration directly:

```text
prompt
cwd
model
profile
sandbox
approval-policy
base-instructions
developer-instructions
compact-prompt
config
```

This maps well to Assyst Daemon because the app can keep one MCP server process alive and call:

```text
tools/call codex       -> create master thread
tools/call codex-reply -> continue master thread
```

### Important Limitation

MCP `threadId` state is scoped to the running `codex mcp-server` process.

Observed behavior:

- `codex` followed by `codex-reply` works inside the same MCP-server process;
- `codex-reply` cannot continue a thread created by regular `codex exec`;
- after restarting `codex mcp-server`, `codex-reply` returns `Session not found for thread_id`.

So MCP mode is a strong fit for the live Electron daemon, but it is not enough by itself for durable resume after app/server restart. For restart recovery, the daemon must either:

- create a new MCP master thread and seed it with a compact transcript summary; or
- use CLI `codex exec resume <thread-id> -` for durable cross-process resume; or
- combine both: MCP for live chat, CLI resume or summary bootstrap after restart.

## Recommendation

For the in-app master chat, prefer MCP mode over direct CLI parsing:

- MCP gives structured `{ threadId, content }` output;
- MCP has a first-class `codex-reply` continuation tool;
- a single long-lived MCP child process matches the Electron background-daemon model;
- the app can serialize all turns through one MCP connection.

Do not use MCP as the only persistence mechanism. Persist the app transcript and current MCP `threadId`; if `codex-reply` reports `Session not found`, create a replacement `codex` thread and bootstrap it from the stored transcript.

## Assyst Codex-Chats MCP Tooling

Assyst Daemon provides a project-local MCP server for the master agent:

```bash
node dist/mcp/codexChatsServer.js
```

Tools:

- `list_codex_chats`: reads `~/.codex/session_index.jsonl` and returns recent chat ids/names.
- `get_codex_chat`: finds the local rollout JSONL for a chat id and returns recent user/assistant messages.
- `list_codex_projects`: reads project entries from `~/.codex/config.toml`.

This server is injected only into the master Codex session through the `codex` MCP tool `config.mcp_servers` field. It is not added to the global Codex config.

Because these tools read `~/.codex`, the master Codex session must run with sufficient local filesystem access. In the Electron app this is currently configured as `sandbox: "danger-full-access"` for the master Codex thread.
