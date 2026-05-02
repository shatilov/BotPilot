export function renderChatPage(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Assyst Daemon</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7fa;
        --panel: #ffffff;
        --text: #182230;
        --muted: #667085;
        --border: #d8dee8;
        --primary: #225ea8;
        --primary-strong: #174a87;
        --success: #16784a;
        --danger: #b42318;
        --shadow: 0 10px 30px rgba(16, 24, 40, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-width: 720px;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background: var(--bg);
      }

      .app {
        display: grid;
        grid-template-rows: auto 1fr auto;
        height: 100vh;
      }

      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 18px;
        background: var(--panel);
        border-bottom: 1px solid var(--border);
      }

      .title {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .mark {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border-radius: 7px;
        background: #172033;
        color: #fff;
        font-weight: 700;
      }

      h1 {
        margin: 0;
        font-size: 15px;
        font-weight: 650;
      }

      .subtitle {
        margin-top: 2px;
        color: var(--muted);
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 520px;
      }

      .controls {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      select,
      input,
      textarea,
      button {
        font: inherit;
      }

      select,
      input {
        height: 34px;
        border: 1px solid var(--border);
        border-radius: 7px;
        background: #fff;
        color: var(--text);
        padding: 0 10px;
      }

      select {
        min-width: 108px;
      }

      main {
        overflow: auto;
        padding: 18px;
      }

      .thread {
        max-width: 980px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .message {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        max-width: min(76%, 760px);
        gap: 4px;
      }

      .message.user {
        align-self: flex-end;
        align-items: flex-end;
      }

      .message.assistant,
      .message.error,
      .message.system {
        align-self: flex-start;
        align-items: flex-start;
      }

      .role {
        color: var(--muted);
        font-size: 12px;
        padding: 0 6px;
      }

      .message.user .role {
        text-align: right;
      }

      .bubble {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 14px 14px 14px 4px;
        padding: 11px 12px;
        box-shadow: var(--shadow);
        width: fit-content;
        max-width: 100%;
      }

      .message.user .bubble {
        background: var(--primary);
        border-color: var(--primary);
        color: #fff;
        border-radius: 14px 14px 4px 14px;
      }

      .message.user .meta {
        color: rgba(255, 255, 255, 0.78);
      }

      .message.user .pill {
        background: rgba(255, 255, 255, 0.14);
        border-color: rgba(255, 255, 255, 0.28);
      }

      .message.error .bubble {
        border-color: #f1a8a0;
        color: var(--danger);
      }

      .content {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        line-height: 1.45;
        font-size: 13px;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 9px;
        color: var(--muted);
        font-size: 11px;
      }

      .pill {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 2px 7px;
        background: #f8fafc;
      }

      footer {
        padding: 12px 18px 16px;
        background: var(--panel);
        border-top: 1px solid var(--border);
      }

      form {
        max-width: 980px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        align-items: end;
      }

      textarea {
        width: 100%;
        min-height: 68px;
        max-height: 180px;
        resize: vertical;
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 10px 11px;
        outline: none;
        color: var(--text);
      }

      textarea:focus,
      select:focus,
      input:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(34, 94, 168, 0.12);
      }

      button {
        height: 38px;
        min-width: 96px;
        border: 0;
        border-radius: 7px;
        background: var(--primary);
        color: #fff;
        font-weight: 600;
        cursor: pointer;
      }

      button:hover {
        background: var(--primary-strong);
      }

      button.secondary {
        min-width: 86px;
        border: 1px solid var(--border);
        background: #fff;
        color: var(--text);
      }

      button.secondary:hover {
        background: #f8fafc;
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .status {
        max-width: 980px;
        margin: 8px auto 0;
        color: var(--muted);
        font-size: 12px;
      }

      .status.busy {
        color: var(--primary);
      }

      .status.error {
        color: var(--danger);
      }

      .activity {
        max-width: 980px;
        margin: 8px auto 0;
        padding: 9px 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #f8fafc;
        color: var(--muted);
        font-size: 12px;
        display: none;
      }

      .activity.visible {
        display: block;
      }

      .activity-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: var(--text);
        font-weight: 600;
        margin-bottom: 6px;
      }

      .activity-lines {
        display: grid;
        gap: 3px;
      }

      .activity-line {
        display: flex;
        gap: 8px;
        align-items: baseline;
      }

      .activity-time {
        flex: 0 0 58px;
        font-variant-numeric: tabular-nums;
        color: #7a8494;
      }

      .activity-text {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      @media (max-width: 780px) {
        body {
          min-width: 0;
        }

        header,
        main,
        footer {
          padding-left: 12px;
          padding-right: 12px;
        }

        .message {
          max-width: 88%;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <header>
        <div class="title">
          <div class="mark">A</div>
          <div>
            <h1>Assyst Daemon</h1>
            <div class="subtitle" id="workspace">Loading workspace...</div>
          </div>
        </div>
        <div class="controls">
          <select id="provider" aria-label="Agent provider"></select>
          <button id="settingsButton" class="secondary" type="button">Settings</button>
        </div>
      </header>

      <main id="scroll">
        <section class="thread" id="thread"></section>
      </main>

      <footer>
        <form id="form">
          <textarea id="input" placeholder="Send a task to the master agent..." autocomplete="off"></textarea>
          <button id="send" type="submit">Send</button>
        </form>
        <div id="status" class="status">Ready</div>
        <div id="activity" class="activity">
          <div class="activity-header">
            <span>Agent activity</span>
            <span id="elapsed">0s</span>
          </div>
          <div id="activityLines" class="activity-lines"></div>
        </div>
      </footer>
    </div>

    <script>
      const thread = document.getElementById("thread");
      const form = document.getElementById("form");
      const input = document.getElementById("input");
      const send = document.getElementById("send");
      const provider = document.getElementById("provider");
      const settingsButton = document.getElementById("settingsButton");
      const status = document.getElementById("status");
      const activity = document.getElementById("activity");
      const activityLines = document.getElementById("activityLines");
      const elapsed = document.getElementById("elapsed");
      const workspace = document.getElementById("workspace");
      const scroll = document.getElementById("scroll");

      let busy = false;
      let activeRequestId = null;
      let activeStartedAt = 0;
      let elapsedTimer = null;

      function setStatus(text, mode) {
        status.textContent = text;
        status.className = "status" + (mode ? " " + mode : "");
      }

      function addMessage(role, text, meta, kind) {
        const item = document.createElement("article");
        item.className = "message " + (kind || role);

        const roleEl = document.createElement("div");
        roleEl.className = "role";
        roleEl.textContent = role;

        const bubble = document.createElement("div");
        bubble.className = "bubble";

        const content = document.createElement("pre");
        content.className = "content";
        content.textContent = text;
        bubble.appendChild(content);

        if (meta && meta.length) {
          const metaEl = document.createElement("div");
          metaEl.className = "meta";
          for (const value of meta) {
            const pill = document.createElement("span");
            pill.className = "pill";
            pill.textContent = value;
            metaEl.appendChild(pill);
          }
          bubble.appendChild(metaEl);
        }

        item.appendChild(roleEl);
        item.appendChild(bubble);
        thread.appendChild(item);
        scroll.scrollTop = scroll.scrollHeight;
        return item;
      }

      function setBusy(value) {
        busy = value;
        send.disabled = value;
        provider.disabled = value;
        input.disabled = value;
      }

      function createRequestId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
          return window.crypto.randomUUID();
        }
        return "run-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      }

      function startActivity(requestId) {
        activeRequestId = requestId;
        activeStartedAt = Date.now();
        activityLines.textContent = "";
        activity.classList.add("visible");
        updateElapsed();
        elapsedTimer = setInterval(updateElapsed, 500);
      }

      function stopActivity() {
        if (elapsedTimer) {
          clearInterval(elapsedTimer);
          elapsedTimer = null;
        }
        updateElapsed();
      }

      function updateElapsed() {
        if (!activeStartedAt) {
          elapsed.textContent = "0s";
          return;
        }
        elapsed.textContent = Math.floor((Date.now() - activeStartedAt) / 1000) + "s";
      }

      function addActivityLine(event) {
        if (!activeRequestId || event.requestId !== activeRequestId) {
          return;
        }

        const line = document.createElement("div");
        line.className = "activity-line";

        const time = document.createElement("span");
        time.className = "activity-time";
        time.textContent = new Date(event.timestamp).toLocaleTimeString();

        const text = document.createElement("span");
        text.className = "activity-text";
        text.textContent = event.message;

        line.appendChild(time);
        line.appendChild(text);
        activityLines.appendChild(line);

        while (activityLines.children.length > 8) {
          activityLines.removeChild(activityLines.firstChild);
        }
      }

      async function init() {
        try {
          window.assyst.onRunEvent(addActivityLine);
          const settings = await window.assyst.getSettings();
          workspace.textContent = settings.workspaceRoot || "Workspace is not set";

          for (const name of settings.providers) {
            const option = document.createElement("option");
            option.value = name;
            option.textContent = name;
            provider.appendChild(option);
          }

          provider.value = settings.defaultProvider;
          addMessage("system", "Master-agent chat is ready. Pick a provider and send a task.", [
            "default: " + settings.defaultProvider,
          ], "system");
        } catch (error) {
          setStatus(error && error.message ? error.message : String(error), "error");
        }
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) {
          return;
        }

        const text = input.value.trim();
        if (!text) {
          return;
        }

        input.value = "";
        const requestId = createRequestId();
        addMessage("user", text, [provider.value], "user");
        setBusy(true);
        startActivity(requestId);
        setStatus("Running " + provider.value + "...", "busy");

        const startedAt = Date.now();
        try {
          const result = await window.assyst.sendMessage({
            requestId,
            text,
            provider: provider.value,
          });
          const output = result.stdout.trim() || result.stderr.trim() || (result.ok ? "Done" : "No output");
          addMessage("master", output, [
            result.provider,
            result.ok ? "ok" : "failed",
            String(result.durationMs) + "ms",
            "exit: " + String(result.exitCode),
          ], result.ok ? "assistant" : "error");
          setStatus("Ready");
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          addMessage("master", message, [String(Date.now() - startedAt) + "ms"], "error");
          setStatus(message, "error");
        } finally {
          stopActivity();
          setBusy(false);
          input.focus();
        }
      });

      settingsButton.addEventListener("click", async () => {
        try {
          await window.assyst.openSettings();
        } catch (error) {
          setStatus(error && error.message ? error.message : String(error), "error");
        }
      });

      input.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          form.requestSubmit();
        }
      });

      init();
    </script>
  </body>
</html>`;
}
