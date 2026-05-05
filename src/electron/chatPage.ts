export function renderChatPage(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BotPilot</title>
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

      .attachments {
        display: grid;
        gap: 8px;
        margin-top: 9px;
      }

      .attachments:first-child {
        margin-top: 0;
      }

      .attachment {
        min-width: min(320px, 100%);
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #f8fafc;
        padding: 9px;
      }

      .attachment.photo,
      .attachment.video,
      .attachment.animation,
      .attachment.video_note,
      .attachment.sticker {
        min-width: min(420px, 100%);
      }

      .message.user .attachment {
        border-color: rgba(255, 255, 255, 0.24);
        background: rgba(255, 255, 255, 0.12);
      }

      .attachment-heading {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: var(--text);
        font-size: 12px;
        font-weight: 650;
      }

      .message.user .attachment-heading {
        color: #fff;
      }

      .attachment-detail {
        color: var(--muted);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .message.user .attachment-detail {
        color: rgba(255, 255, 255, 0.72);
      }

      .attachment audio {
        display: block;
        width: 100%;
        height: 32px;
        margin-top: 8px;
      }

      .attachment-image,
      .attachment-video {
        display: block;
        width: 100%;
        max-height: 360px;
        margin-top: 8px;
        border-radius: 7px;
        background: #101828;
        object-fit: contain;
      }

      .attachment-image {
        height: auto;
      }

      .attachment-link {
        display: inline-block;
        margin-top: 8px;
        color: var(--primary);
        font-size: 12px;
        overflow-wrap: anywhere;
      }

      .message.user .attachment-link {
        color: #fff;
      }

      .transcript {
        margin-top: 8px;
        border-top: 1px solid var(--border);
        padding-top: 8px;
        color: var(--text);
      }

      .message.user .transcript {
        border-color: rgba(255, 255, 255, 0.2);
        color: #fff;
      }

      .transcript-label {
        margin-bottom: 4px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 650;
      }

      .message.user .transcript-label {
        color: rgba(255, 255, 255, 0.72);
      }

      .transcript-text {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        line-height: 1.4;
        font-size: 12px;
      }

      .transcript.failed .transcript-text,
      .transcript.unavailable .transcript-text {
        color: var(--muted);
      }

      .message.user .transcript.failed .transcript-text,
      .message.user .transcript.unavailable .transcript-text {
        color: rgba(255, 255, 255, 0.72);
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
            <h1>BotPilot</h1>
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
      const seenChatEventIds = new Set();

      function setStatus(text, mode) {
        status.textContent = text;
        status.className = "status" + (mode ? " " + mode : "");
      }

      function addMessage(role, text, meta, kind, attachments) {
        const item = document.createElement("article");
        item.className = "message " + (kind || role);

        const roleEl = document.createElement("div");
        roleEl.className = "role";
        roleEl.textContent = role;

        const bubble = document.createElement("div");
        bubble.className = "bubble";

        const normalizedText = typeof text === "string" ? text : "";
        if (normalizedText.trim()) {
          const content = document.createElement("pre");
          content.className = "content";
          content.textContent = normalizedText;
          bubble.appendChild(content);
        }

        if (attachments && attachments.length) {
          bubble.appendChild(renderAttachments(attachments));
        }

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

      function renderAttachments(attachments) {
        const list = document.createElement("div");
        list.className = "attachments";
        for (const attachment of attachments) {
          list.appendChild(renderAttachment(attachment));
        }
        return list;
      }

      function renderAttachment(attachment) {
        const card = document.createElement("div");
        card.className = "attachment " + (attachment.kind || "unknown");

        const heading = document.createElement("div");
        heading.className = "attachment-heading";

        const title = document.createElement("span");
        title.textContent = attachmentTitle(attachment);
        heading.appendChild(title);

        const detail = attachmentDetail(attachment);
        if (detail) {
          const detailEl = document.createElement("span");
          detailEl.className = "attachment-detail";
          detailEl.textContent = detail;
          heading.appendChild(detailEl);
        }
        card.appendChild(heading);

        const mediaType = classifyAttachmentMedia(attachment);
        if (mediaType === "audio" && attachment.mediaUrl) {
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.preload = "metadata";
          audio.src = attachment.mediaUrl;
          card.appendChild(audio);
        } else if (mediaType === "image" && attachment.mediaUrl) {
          const image = document.createElement("img");
          image.className = "attachment-image";
          image.loading = "lazy";
          image.alt = attachmentTitle(attachment);
          image.src = attachment.mediaUrl;
          if (attachment.width) {
            image.width = attachment.width;
          }
          if (attachment.height) {
            image.height = attachment.height;
          }
          card.appendChild(image);
        } else if (mediaType === "video" && attachment.mediaUrl) {
          const video = document.createElement("video");
          video.className = "attachment-video";
          video.controls = true;
          video.preload = "metadata";
          video.playsInline = true;
          video.src = attachment.mediaUrl;
          if (attachment.kind === "animation") {
            video.muted = true;
            video.loop = true;
          }
          card.appendChild(video);
        } else if (attachment.mediaUrl) {
          const link = document.createElement("a");
          link.className = "attachment-link";
          link.href = attachment.mediaUrl;
          link.textContent = attachment.fileName || "Open attachment";
          card.appendChild(link);
        }

        const transcript = renderTranscript(attachment.transcript);
        if (transcript) {
          card.appendChild(transcript);
        }

        return card;
      }

      function renderTranscript(transcript) {
        if (!transcript) {
          return null;
        }

        const block = document.createElement("div");
        block.className = "transcript " + transcript.status;

        const label = document.createElement("div");
        label.className = "transcript-label";
        label.textContent = "Transcript";
        block.appendChild(label);

        const text = document.createElement("pre");
        text.className = "transcript-text";
        if (transcript.status === "ok" && transcript.text) {
          text.textContent = transcript.text;
        } else if (transcript.status === "failed") {
          text.textContent = "Transcription failed" + (transcript.error ? ": " + transcript.error : ".");
        } else {
          text.textContent = "Transcription is not configured.";
        }
        block.appendChild(text);

        return block;
      }

      function attachmentTitle(attachment) {
        if (attachment.kind === "voice") {
          return "Voice message";
        }
        if (attachment.kind === "audio") {
          return "Audio";
        }
        if (attachment.kind === "photo") {
          return "Photo";
        }
        if (attachment.kind === "video") {
          return "Video";
        }
        if (attachment.kind === "animation") {
          return "Animation";
        }
        if (attachment.kind === "video_note") {
          return "Video note";
        }
        if (attachment.kind === "sticker") {
          return "Sticker";
        }
        if (attachment.kind === "document") {
          return attachment.fileName || "Document";
        }
        return attachment.fileName || attachment.kind || "Attachment";
      }

      function attachmentDetail(attachment) {
        const parts = [];
        if (typeof attachment.durationSeconds === "number") {
          parts.push(formatDuration(attachment.durationSeconds));
        }
        if (typeof attachment.width === "number" && typeof attachment.height === "number") {
          parts.push(attachment.width + "x" + attachment.height);
        }
        if (typeof attachment.sizeBytes === "number") {
          parts.push(formatBytes(attachment.sizeBytes));
        }
        if (!parts.length && attachment.mimeType) {
          parts.push(attachment.mimeType);
        }
        return parts.join(" · ");
      }

      function formatDuration(seconds) {
        const normalized = Math.max(0, Math.round(seconds));
        const minutes = Math.floor(normalized / 60);
        const remainingSeconds = String(normalized % 60).padStart(2, "0");
        return minutes + ":" + remainingSeconds;
      }

      function formatBytes(bytes) {
        if (bytes < 1024) {
          return bytes + " B";
        }
        if (bytes < 1024 * 1024) {
          return Math.round(bytes / 1024) + " KB";
        }
        return (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0) + " MB";
      }

      function classifyAttachmentMedia(attachment) {
        const mimeType = String(attachment.mimeType || "").toLowerCase();
        const fileName = String(attachment.fileName || "").toLowerCase();
        if (attachment.kind === "voice" || attachment.kind === "audio" || mimeType.startsWith("audio/")) {
          return "audio";
        }
        if (
          attachment.kind === "photo" ||
          mimeType.startsWith("image/") ||
          fileName.endsWith(".jpg") ||
          fileName.endsWith(".jpeg") ||
          fileName.endsWith(".png") ||
          fileName.endsWith(".webp") ||
          fileName.endsWith(".gif")
        ) {
          return "image";
        }
        if (
          attachment.kind === "video" ||
          attachment.kind === "video_note" ||
          attachment.kind === "animation" ||
          mimeType.startsWith("video/") ||
          fileName.endsWith(".mp4") ||
          fileName.endsWith(".mov") ||
          fileName.endsWith(".webm")
        ) {
          return "video";
        }
        return "file";
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

      function applyChatMessageEvent(event, replay) {
        if (!event || !event.eventId || seenChatEventIds.has(event.eventId)) {
          return;
        }

        seenChatEventIds.add(event.eventId);
        addMessage(event.role, event.text, event.meta || [], event.kind, event.attachments || []);

        if (replay) {
          return;
        }

        if (event.kind === "user") {
          startActivity(event.requestId);
          setStatus("Running " + (event.meta && event.meta[0] ? event.meta[0] : "task") + "...", "busy");
        } else if ((event.kind === "assistant" || event.kind === "error") && event.requestId === activeRequestId) {
          stopActivity();
          setStatus(event.kind === "assistant" ? "Ready" : "Agent failed", event.kind === "assistant" ? undefined : "error");
        }
      }

      async function init() {
        try {
          window.botpilot.onChatMessage((event) => applyChatMessageEvent(event, false));
          window.botpilot.onRunEvent(addActivityLine);
          const settings = await window.botpilot.getSettings();
          workspace.textContent = settings.workspaceRoot || "Workspace is not set";

          for (const name of settings.providers) {
            const option = document.createElement("option");
            option.value = name;
            option.textContent = name;
            provider.appendChild(option);
          }

          provider.value = settings.defaultProvider;
          const history = await window.botpilot.getChatHistory();
          if (history.length) {
            for (const event of history) {
              applyChatMessageEvent(event, true);
            }
          } else {
            addMessage("system", "Master-agent chat is ready. Pick a provider and send a task.", [
              "default: " + settings.defaultProvider,
            ], "system");
          }
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
        setBusy(true);
        setStatus("Sending " + provider.value + " task...", "busy");

        try {
          await window.botpilot.sendMessage({
            requestId,
            text,
            provider: provider.value,
          });
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          setStatus(message, "error");
        } finally {
          stopActivity();
          setBusy(false);
          input.focus();
        }
      });

      settingsButton.addEventListener("click", async () => {
        try {
          await window.botpilot.openSettings();
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
