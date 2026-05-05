export function renderSettingsPage(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BotPilot Settings</title>
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
        --danger: #b42318;
        --success: #16784a;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text);
        background: var(--bg);
      }

      .window {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr auto;
      }

      header {
        padding: 16px 18px 12px;
        background: var(--panel);
        border-bottom: 1px solid var(--border);
      }

      h1 {
        margin: 0;
        font-size: 15px;
        font-weight: 650;
      }

      .subtitle {
        margin-top: 3px;
        color: var(--muted);
        font-size: 12px;
      }

      main {
        padding: 18px;
      }

      form {
        display: grid;
        gap: 14px;
      }

      .field {
        display: grid;
        gap: 6px;
      }

      label {
        font-size: 12px;
        font-weight: 650;
      }

      input {
        width: 100%;
        height: 38px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--panel);
        color: var(--text);
        padding: 0 10px;
        font: inherit;
      }

      input:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(34, 94, 168, 0.12);
      }

      .hint {
        min-height: 16px;
        color: var(--muted);
        font-size: 12px;
      }

      .token-state {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        min-height: 24px;
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 2px 8px;
        color: var(--muted);
        background: #fff;
        font-size: 12px;
      }

      footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 12px 18px 16px;
        background: var(--panel);
        border-top: 1px solid var(--border);
      }

      .status {
        min-width: 0;
        color: var(--muted);
        font-size: 12px;
        overflow-wrap: anywhere;
      }

      .status.error {
        color: var(--danger);
      }

      .status.saved {
        color: var(--success);
      }

      .actions {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
      }

      button {
        height: 36px;
        min-width: 86px;
        border-radius: 7px;
        border: 1px solid transparent;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .secondary {
        background: #fff;
        border-color: var(--border);
        color: var(--text);
      }

      .secondary:hover {
        background: #f8fafc;
      }

      .primary {
        background: var(--primary);
        color: #fff;
      }

      .primary:hover {
        background: var(--primary-strong);
      }
    </style>
  </head>
  <body>
    <div class="window">
      <header>
        <h1>Settings</h1>
        <div class="subtitle">Telegram access</div>
      </header>

      <main>
        <form id="form">
          <div class="field">
            <label for="botToken">Telegram bot token</label>
            <input id="botToken" type="password" autocomplete="off" spellcheck="false" />
            <div id="tokenState" class="token-state">Token not configured</div>
            <div class="hint">Leave empty to keep the saved token.</div>
          </div>

          <div class="field">
            <label for="trustedChatId">Trusted chat_id</label>
            <input id="trustedChatId" type="text" autocomplete="off" spellcheck="false" />
            <div class="hint">Only this Telegram chat will be allowed to control the daemon.</div>
          </div>

          <div class="field">
            <label for="pollingMaxIntervalMinutes">Max polling interval, minutes</label>
            <input id="pollingMaxIntervalMinutes" type="number" min="1" max="30" step="1" />
            <div class="hint">After each answer the bot polls every minute for 5 minutes, then backs off up to this value.</div>
          </div>
        </form>
      </main>

      <footer>
        <div id="status" class="status">Loading...</div>
        <div class="actions">
          <button id="clearToken" class="secondary" type="button">Clear token</button>
          <button id="save" class="primary" type="submit" form="form">Save</button>
        </div>
      </footer>
    </div>

    <script>
      const form = document.getElementById("form");
      const botToken = document.getElementById("botToken");
      const trustedChatId = document.getElementById("trustedChatId");
      const pollingMaxIntervalMinutes = document.getElementById("pollingMaxIntervalMinutes");
      const tokenState = document.getElementById("tokenState");
      const status = document.getElementById("status");
      const save = document.getElementById("save");
      const clearToken = document.getElementById("clearToken");
      let currentTokenConfigured = false;

      function setStatus(text, mode) {
        status.textContent = text;
        status.className = "status" + (mode ? " " + mode : "");
      }

      function setBusy(value) {
        save.disabled = value;
        clearToken.disabled = value || !currentTokenConfigured;
        botToken.disabled = value;
        trustedChatId.disabled = value;
        pollingMaxIntervalMinutes.disabled = value;
      }

      function renderSettings(settings) {
        currentTokenConfigured = Boolean(settings.botTokenConfigured);
        trustedChatId.value = settings.trustedChatId || "";
        pollingMaxIntervalMinutes.value = String(settings.pollingMaxIntervalMinutes || 30);
        tokenState.textContent = currentTokenConfigured ? "Token configured" : "Token not configured";
        clearToken.disabled = !currentTokenConfigured;
      }

      async function load() {
        try {
          const settings = await window.botpilot.getTelegramSettings();
          renderSettings(settings);
          setStatus(settings.encryptionAvailable ? "Ready" : "Secure storage unavailable", settings.encryptionAvailable ? "" : "error");
        } catch (error) {
          setStatus(error && error.message ? error.message : String(error), "error");
        }
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setBusy(true);
        setStatus("Saving...");
        try {
          const settings = await window.botpilot.saveTelegramSettings({
            botToken: botToken.value,
            trustedChatId: trustedChatId.value,
            pollingMaxIntervalMinutes: Number(pollingMaxIntervalMinutes.value),
          });
          botToken.value = "";
          renderSettings(settings);
          setStatus("Saved", "saved");
        } catch (error) {
          setStatus(error && error.message ? error.message : String(error), "error");
        } finally {
          setBusy(false);
        }
      });

      clearToken.addEventListener("click", async () => {
        setBusy(true);
        setStatus("Saving...");
        try {
          const settings = await window.botpilot.saveTelegramSettings({
            clearBotToken: true,
            trustedChatId: trustedChatId.value,
            pollingMaxIntervalMinutes: Number(pollingMaxIntervalMinutes.value),
          });
          botToken.value = "";
          renderSettings(settings);
          setStatus("Token cleared", "saved");
        } catch (error) {
          setStatus(error && error.message ? error.message : String(error), "error");
        } finally {
          setBusy(false);
        }
      });

      load();
    </script>
  </body>
</html>`;
}
