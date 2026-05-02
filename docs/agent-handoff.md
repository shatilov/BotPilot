# Assyst Daemon Agent Handoff

Last updated: 2026-05-03.

This document is for future agents continuing work on `/Users/shatilov/Work/assyst-daemon`.

## Goal

Assyst Daemon is a local macOS desktop daemon. It should read trusted Telegram bot messages, normalize them into one assistant conversation, pass them to a master agent, and return the master agent answer back to Telegram. The master agent can be backed by Codex, Claude, or another console agent, but product behavior must feel like one continuous assistant.

## Current Stack

- TypeScript.
- Electron desktop shell.
- Tray/menu-bar background app.
- Vitest tests.
- Codex MCP backend for the live master-agent dialog.
- Project-local MCP server exposing local Codex chat/project data to the master Codex agent.

## Implemented Surface

### Electron App

- Main Electron process: `src/electron/main.ts`.
- Chat UI: `src/electron/chatPage.ts`.
- Settings UI: `src/electron/settingsPage.ts`.
- Preload API: `src/electron/preload.ts`.
- Tray/menu-bar controller: `src/electron/trayController.ts`.
- Dynamic background scheduler: `src/electron/backgroundRuntime.ts`.
- Settings storage: `src/electron/settingsStore.ts`.

The app starts a main chat window and keeps running when the window is closed. The tray/menu-bar menu can show the window, open settings, pause/resume background work, and quit.

The chat UI is styled like a messenger:

- user messages align right;
- assistant/system/error messages align left;
- agent activity/progress is shown while Codex is running.

Important: raw model chain-of-thought is not displayed. The UI only shows operational progress events such as queueing, Codex MCP startup, thread creation/resume, waiting, completion, and errors.

### Settings

Settings are stored under Electron `app.getPath("userData")`.

Current files:

- `settings.json`: Telegram settings.
- `dialogs.json`: persisted master dialog metadata.
- `telegram-state.json`: Telegram polling offset and last answer timestamp.
- `telegram-files/`: downloaded Telegram files.

Telegram settings currently include:

- encrypted bot token;
- trusted controlling `chat_id`;
- maximum polling interval in minutes.

The bot token is stored through Electron `safeStorage`. The renderer only receives `botTokenConfigured`; it does not receive the saved token value.

### Master Agent

Core files:

- `src/master/MasterAgent.ts`
- `src/master/promptBuilder.ts`
- `src/master/DialogStore.ts`
- `src/domain/types.ts`

`MasterAgent` accepts an `IncomingMessage`, builds a master prompt, and routes it to the selected provider adapter. Sensitive metadata keys such as token/secret/password/session/api-key are redacted before being embedded in the prompt.

Master-agent invariant:

- one durable master dialog per configured master identity;
- turns for that dialog are serialized;
- dialog/session state is stored outside source files;
- do not turn the master Codex interaction into isolated one-shot calls.

### Agent Backends

Core files:

- `src/agents/CodexMcpAdapter.ts`
- `src/agents/CodexMcpClient.ts`
- `src/agents/CodexAdapter.ts`
- `src/agents/ClaudeAdapter.ts`
- `src/agents/CommandAgentAdapter.ts`
- `src/agents/GenericCommandAdapter.ts`
- `src/agents/createAdapters.ts`

Electron currently overrides the default Codex adapter with `CodexMcpAdapter`.

`CodexMcpAdapter`:

- starts `codex mcp-server` through `CodexMcpClient`;
- calls the `codex` MCP tool for the first turn;
- persists returned `threadId`;
- calls `codex-reply` for later turns;
- serializes turns through an internal queue;
- emits progress events for the chat UI;
- handles `Session not found` by deleting stored state and creating a replacement Codex MCP thread.

Current limitation: Codex MCP thread state is process-local. After `codex mcp-server` restarts, the stored `threadId` may not resume. Replacement is implemented, but compact transcript seeding is not implemented yet.

### Codex Chats MCP Tools

Core files:

- `src/mcp/codexChatsServer.ts`
- `src/codex/codexData.ts`

The master Codex thread receives an Assyst MCP server with:

- `list_codex_chats`
- `get_codex_chat`
- `list_codex_projects`

These tools read local Codex data from `~/.codex`, so the master Codex MCP backend currently uses `sandbox: "danger-full-access"` in Electron.

Do not expose secrets from local Codex transcripts. The developer instructions passed to Codex explicitly tell it to summarize sensitive content instead of quoting it.

### Telegram Transport

Core files:

- `src/telegram/TelegramBotClient.ts`
- `src/telegram/TelegramPollingService.ts`
- `src/telegram/TelegramMessageNormalizer.ts`
- `src/telegram/TelegramPollingCadence.ts`
- `src/telegram/TelegramStateStore.ts`
- `src/telegram/types.ts`

Telegram behavior:

- polls `getUpdates`;
- stores offset in `telegram-state.json`;
- ignores messages not from the trusted `chat_id`;
- normalizes Telegram updates into `IncomingMessage`;
- downloads supported files through `getFile` into `telegram-files/`;
- calls the master agent;
- sends the answer back with `sendMessage`;
- sends `typing` chat actions every 4 seconds while the master agent runs.

Supported incoming Telegram content:

- text;
- captions;
- photo;
- animation;
- audio;
- document;
- paid media photo/video;
- sticker;
- video;
- video note;
- voice;
- callback query;
- non-file payloads such as contact, dice, poll, location, venue, web app data, and Telegram service events.

For non-file payloads, the normalizer creates a non-empty textual task and includes Telegram details in metadata. Unknown/new Telegram fields are not meant to crash processing; keep this behavior.

Polling cadence:

- before any answer, poll at configured max interval;
- after an answer, poll every 1 minute for 5 minutes;
- after that, back off exponentially: 2m, 4m, 8m, etc.;
- maximum interval is configurable but capped at 30 minutes.

### Tests

Current tests:

- `test/backgroundRuntime.test.ts`
- `test/masterAgent.test.ts`
- `test/telegramMessageNormalizer.test.ts`
- `test/telegramPollingCadence.test.ts`

Last verified commands:

```bash
npm run build
npm test
npm audit
```

Last known result:

- build passes;
- 11 tests pass;
- npm audit reports 0 vulnerabilities.

## Important Commands

Install dependencies:

```bash
npm install
```

Run Electron app:

```bash
npm run dev
```

Run master agent from CLI:

```bash
npm run master -- --provider codex --text "Summarize the project structure" --cwd /Users/shatilov/Work/assyst-daemon
```

Build and test:

```bash
npm run build
npm test
npm audit
```

Manual Electron launch used during development:

```bash
open -na /Users/shatilov/Work/assyst-daemon/node_modules/electron/dist/Electron.app --args /Users/shatilov/Work/assyst-daemon
```

Stop current dev Electron process:

```bash
pkill -f '/Users/shatilov/Work/assyst-daemon/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /Users/shatilov/Work/assyst-daemon'
```

## Known Design Decisions

- Telegram ingestion is a transport layer, not part of `MasterAgent`.
- The master agent sees one normalized `IncomingMessage` shape regardless of source.
- Provider-specific persistent dialog handling belongs in provider adapters or dialog/session storage.
- Generic command adapters should stay stateless.
- Renderer code must not receive saved secret values.
- Telegram messages from untrusted chats must not reach the master agent.
- File paths for downloaded Telegram attachments are passed to the master agent as local paths.
- Background scheduling should remain dynamic because Telegram polling cadence depends on recent answers.

## Current Gaps / Next Work

- Add a visible Telegram status panel in the app window, not only tray status.
- Add manual "poll now" action for development/debugging.
- Add integration tests for `TelegramPollingService` with a fake Telegram client and fake master agent.
- Add transcript storage so a replacement Codex MCP thread can be seeded after MCP restart.
- Consider CLI resume fallback if Codex MCP thread state is lost.
- Decide how to handle voice transcription. Voice files are downloaded now, but no STT pipeline is wired into the app transport yet.
- Decide how to render image/document summaries in Telegram responses if the master agent produces long output.
- Add macOS launch-at-login and power/wake behavior once product flow is stable.
- Package/sign the Electron app for real macOS use.

## Safety Notes

- Do not print, log, or return the Telegram bot token.
- Do not remove trusted-chat filtering.
- Do not read arbitrary local Codex transcripts unless the user asks through the trusted interface.
- Keep `~/.codex` MCP tools read-only.
- Avoid destructive git commands; the project currently has many untracked files.
