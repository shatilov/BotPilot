# BotPilot

BotPilot lets you control your computer through a bot-powered local agent. A trusted Telegram bot or the local Electron chat sends normalized tasks to a master agent, which can delegate execution to Codex, Claude, or another console command.

## Current Scope

- TypeScript project with an Electron shell.
- Background Electron runtime that keeps working after the window is closed.
- Menu-bar/tray icon with show, pause/resume, and quit actions.
- In-app chat wired to the master agent.
- Settings window for Telegram bot token and a trusted controlling `chat_id`.
- Telegram polling transport with trusted-chat filtering, adaptive polling cadence, file downloads, and replies back to the chat.
- Codex MCP backend for one live master-agent dialog.
- BotPilot MCP tools for the master agent to list/read local Codex chats and list Codex projects.
- CLI entrypoint for local master-agent runs.
- Agent adapters for Codex, Claude, and generic commands.
- Testable orchestration core independent from Telegram.

Telegram ingestion is implemented as a transport layer. It calls the master agent with an `IncomingMessage` payload, then sends the normalized answer back to Telegram.

The target master-agent behavior is one dialog per master identity. For the live Electron app, Codex MCP mode is the preferred backend: create a thread with the `codex` MCP tool, persist its `threadId`, and continue it with `codex-reply`. MCP thread state is process-local, so restart recovery still needs a stored transcript or CLI resume fallback. See [AGENTS.md](AGENTS.md) and [docs/codex-cli.md](docs/codex-cli.md).

## Usage

Install dependencies:

```bash
npm install
```

Run a master task with Codex:

```bash
npm run master -- --provider codex --text "Summarize the project structure" --cwd /path/to/workspace
```

Run with Claude:

```bash
npm run master -- --provider claude --text "Summarize the project structure" --cwd /path/to/workspace
```

Start the Electron shell:

```bash
npm run dev
```

The app keeps running in the background when the window is closed. Use the tray/menu-bar icon to show the window, pause/resume background work, or quit.

Use the `Settings` button or the tray/menu-bar `Settings...` item to configure Telegram access. The bot token is stored through Electron secure storage and is not sent back to the renderer after saving; the trusted `chat_id` and maximum polling interval are stored in the app settings file.

Telegram polling reads `getUpdates`, filters all control messages by trusted `chat_id`, downloads supported file attachments through `getFile`, and passes text, captions, media paths, and service-message summaries to the master agent. After an answer is sent, polling runs every minute for five minutes, then backs off exponentially up to the configured maximum interval, capped at 30 minutes.

The window chat uses Codex through `codex mcp-server` by default. The first message creates a live Codex MCP thread; later messages continue it with `codex-reply`.

The master Codex thread also receives a project-local MCP server with `list_codex_chats`, `get_codex_chat`, and `list_codex_projects`. This requires the master Codex sandbox to run with local filesystem access because the tools read `~/.codex`.

## Architecture

```text
Telegram/Electron transport
  -> IncomingMessage
  -> MasterAgent
  -> Dialog/session store
  -> AgentAdapter
  -> codex MCP codex-reply / claude / custom command
  -> AgentRunResult
```

The master agent owns routing, prompt construction, and result normalization. Each CLI agent is hidden behind an adapter so the daemon can switch providers without changing Telegram or scheduling code.
