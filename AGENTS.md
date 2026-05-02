# Assyst Daemon Agent Notes

Read this file first, then read [docs/agent-handoff.md](docs/agent-handoff.md) for the current implementation map, verification status, and next work.

## Product Direction

Assyst Daemon is a local desktop daemon for routing Telegram/user messages to a master agent. The master agent can use Codex, Claude, or another console agent, but the product-level behavior must feel like one continuous assistant.

## Master-Agent Invariant

The master agent must have one durable dialog per configured master identity.

Do not implement master-agent messaging as isolated one-shot runs. A one-shot run loses context, breaks follow-up tasks, and makes Telegram/Electron chat history diverge from the actual agent session.

Required behavior:

- Create one master dialog when the first task arrives.
- Persist the backing CLI session id in daemon state.
- Resume that same dialog for every later user message.
- Serialize master-agent turns for the same dialog; queue or reject concurrent turns.
- If the stored session cannot be resumed, create a replacement dialog deliberately and record the reason.
- Keep the app chat transcript and the backing CLI session aligned.

## Codex CLI Contract

Current verified Codex CLI behavior:

- `codex exec [PROMPT]` runs Codex non-interactively.
- `codex exec resume [SESSION_ID] [PROMPT]` resumes a previous non-interactive session.
- `codex exec resume [SESSION_ID] -` reads the resumed prompt from stdin.
- `codex exec resume --last` exists, but daemon code should not use it for production routing because it can pick the wrong session.
- Do not use `--ephemeral` for the master agent; ephemeral runs cannot provide durable dialog state.

Current verified Codex MCP behavior:

- `codex mcp-server` starts a stdio MCP server.
- It exposes `codex` to create a thread and `codex-reply` to continue a thread.
- Both tools return structured content with `threadId` and `content`.
- MCP thread state lives in the running MCP-server process. It does not survive server restart.

Preferred implementation shape:

```text
Electron/Telegram message
  -> DialogStore resolves master dialog id
  -> CodexMcpClient
  -> tools/call codex or codex-reply
  -> AgentRunResult
```

First run:

```text
tools/call codex
  -> persist returned threadId
```

Subsequent runs:

```text
tools/call codex-reply with stored threadId
```

## Implementation Notes

- Keep generic `CommandAgentAdapter` stateless; persistent session behavior belongs in provider-specific adapters or a dialog/session layer above them.
- The Electron UI may show one chat thread, but that is not enough. The CLI backend must also resume one persistent dialog.
- Store dialog state outside source files, for example under app user data or a local state directory ignored by git.
- Do not rely on UI history as the source of truth for Codex state.
- Keep Telegram ingestion separate from master dialog orchestration.
- If `codex-reply` returns `Session not found`, create a replacement MCP thread and seed it with a compact summary from stored transcript.

## Current Implementation Snapshot

- Electron main process is in `src/electron/main.ts`.
- Messenger-like chat UI is in `src/electron/chatPage.ts`.
- Settings UI is in `src/electron/settingsPage.ts`.
- Telegram settings storage is in `src/electron/settingsStore.ts`.
- Telegram polling transport is in `src/telegram/TelegramPollingService.ts`.
- Telegram message normalization is in `src/telegram/TelegramMessageNormalizer.ts`.
- Telegram polling cadence is in `src/telegram/TelegramPollingCadence.ts`.
- Codex MCP master-agent backend is in `src/agents/CodexMcpAdapter.ts`.
- Local Codex chat/project MCP tools are in `src/mcp/codexChatsServer.ts`.

Do not send saved secrets to renderer code. The Telegram bot token is stored through Electron `safeStorage`; renderer code should receive only `botTokenConfigured`.

Telegram messages must be filtered by trusted `chat_id` before reaching `MasterAgent`.

Run these checks before handing off substantial changes:

```bash
npm run build
npm test
npm audit
```
