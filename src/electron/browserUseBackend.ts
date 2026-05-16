import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { BrowserWindow } from "electron";

interface BrowserUseRequest {
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface BrowserUseTab {
  id: string;
  url: string;
  title: string;
}

interface ManagedTab extends BrowserUseTab {
  window: BrowserWindow;
}

type JsonValue = unknown;

const BROWSER_USE_SOCKET_DIR = path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "codex-browser-use");
const SOCKET_PREFIX = "botpilot-";
const SOCKET_SUFFIX = ".sock";

export class BotPilotBrowserUseBackend {
  private readonly socketPath = path.join(BROWSER_USE_SOCKET_DIR, `${SOCKET_PREFIX}${randomUUID()}${SOCKET_SUFFIX}`);
  private server: net.Server | undefined;
  private readonly sockets = new Set<net.Socket>();
  private readonly tabs = new Map<string, ManagedTab>();
  private selectedTabId: string | undefined;
  private nextTabId = 1;

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    mkdirSync(BROWSER_USE_SOCKET_DIR, { recursive: true });
    this.removeStaleBotPilotSockets();
    this.server = net.createServer((socket) => this.handleSocket(socket));

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error("BotPilot browser backend server was not created"));
        return;
      }

      server.once("error", reject);
      server.listen(this.socketPath, () => {
        server.off("error", reject);
        console.info(`BotPilot Browser Use backend listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const tab of this.tabs.values()) {
      if (!tab.window.isDestroyed()) {
        tab.window.close();
      }
    }
    this.tabs.clear();
    this.selectedTabId = undefined;

    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    this.unlinkSocket(this.socketPath);
  }

  private removeStaleBotPilotSockets(): void {
    for (const entry of readdirSync(BROWSER_USE_SOCKET_DIR)) {
      if (entry.startsWith(SOCKET_PREFIX) && entry.endsWith(SOCKET_SUFFIX)) {
        this.unlinkSocket(path.join(BROWSER_USE_SOCKET_DIR, entry));
      }
    }
  }

  private unlinkSocket(socketPath: string): void {
    if (!existsSync(socketPath)) {
      return;
    }

    try {
      unlinkSync(socketPath);
    } catch (error) {
      console.error(`Failed to remove Browser Use socket ${socketPath}`, error);
    }
  }

  private handleSocket(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => {
      this.sockets.delete(socket);
    });

    let buffer = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 4) {
        const frameLength = buffer.readUInt32LE(0);
        if (buffer.length < frameLength + 4) {
          return;
        }

        const frame = buffer.subarray(4, frameLength + 4);
        buffer = buffer.subarray(frameLength + 4);
        void this.handleFrame(socket, frame);
      }
    });
  }

  private async handleFrame(socket: net.Socket, frame: Buffer): Promise<void> {
    let request: BrowserUseRequest;
    try {
      request = JSON.parse(frame.toString("utf8")) as BrowserUseRequest;
    } catch (error) {
      this.writeResponse(socket, null, undefined, error);
      return;
    }

    try {
      const result = await this.handleRequest(request);
      this.writeResponse(socket, request.id ?? null, result);
    } catch (error) {
      this.writeResponse(socket, request.id ?? null, undefined, error);
    }
  }

  private async handleRequest(request: BrowserUseRequest): Promise<JsonValue> {
    const method = request.method;
    const params = request.params ?? {};

    switch (method) {
      case "getInfo":
        return this.getInfo(params);
      case "createTab":
        return this.createTab();
      case "getTabs":
        return this.getTabs();
      case "getUserTabs":
        return this.getTabs();
      case "nameSession":
      case "finalizeTabs":
      case "attach":
      case "detach":
        return {};
      case "moveMouse":
        return {};
      case "executeUnhandledCommand":
        return this.executeUnhandledCommand(params);
      case "navigateTabUrl":
        return this.navigateTabUrl(params);
      case "executeCdp":
        return this.executeCdp(params);
      default:
        throw new Error(`Unsupported BotPilot browser backend method: ${method ?? "[missing]"}`);
    }
  }

  private getInfo(params: Record<string, unknown>): JsonValue {
    const sessionId = typeof params.session_id === "string" ? params.session_id : undefined;
    return {
      name: "BotPilot Browser",
      type: "iab",
      metadata: sessionId ? { codexSessionId: sessionId } : {},
      capabilities: {
        browser: [],
        tab: [],
      },
    };
  }

  private createTab(): JsonValue {
    const id = String(this.nextTabId++);
    const window = new BrowserWindow({
      width: 1180,
      height: 820,
      title: "BotPilot Browser",
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    const tab: ManagedTab = {
      id,
      window,
      url: "about:blank",
      title: "New Tab",
    };
    this.tabs.set(id, tab);
    this.selectedTabId = id;

    window.webContents.on("page-title-updated", (_event, title) => {
      tab.title = title;
    });
    window.webContents.on("did-navigate", (_event, url) => {
      tab.url = url;
    });
    window.webContents.on("did-navigate-in-page", (_event, url) => {
      tab.url = url;
    });
    window.on("focus", () => {
      this.selectedTabId = id;
    });
    window.on("closed", () => {
      this.tabs.delete(id);
      if (this.selectedTabId === id) {
        this.selectedTabId = this.tabs.keys().next().value;
      }
    });

    return { id };
  }

  private getTabs(): JsonValue {
    return Array.from(this.tabs.values(), (tab) => this.toBrowserUseTab(tab));
  }

  private async executeUnhandledCommand(params: Record<string, unknown>): Promise<JsonValue> {
    const type = this.readString(params, "type");

    switch (type) {
      case "create_tab":
        return this.createTab();
      case "list_tabs":
      case "get_tabs":
        return { tabs: this.getTabs() };
      case "selected_tab":
        return { id: this.selectedTabId ?? null };
      case "navigate_tab_url":
        return this.navigateTabUrl(params);
      case "navigate_tab_reload":
        return this.reloadTab(params);
      case "navigate_tab_back":
        return this.goHistory(params, "back");
      case "navigate_tab_forward":
        return this.goHistory(params, "forward");
      case "close_tab":
        return this.closeTab(params);
      case "tabs_content":
        return this.tabsContent(params);
      case "name_session":
        return {};
      default:
        throw new Error(`Unsupported BotPilot browser command: ${type ?? "[missing]"}`);
    }
  }

  private async navigateTabUrl(params: Record<string, unknown>): Promise<JsonValue> {
    const tab = this.requireTab(params);
    const url = this.readString(params, "url");
    if (!url) {
      throw new Error("navigate_tab_url requires url");
    }

    await this.loadUrl(tab, url);
    return {};
  }

  private async reloadTab(params: Record<string, unknown>): Promise<JsonValue> {
    const tab = this.requireTab(params);
    const wait = this.waitForNavigation(tab);
    tab.window.webContents.reload();
    await wait;
    return {};
  }

  private async goHistory(params: Record<string, unknown>, direction: "back" | "forward"): Promise<JsonValue> {
    const tab = this.requireTab(params);
    const webContents = tab.window.webContents;
    if (direction === "back" && webContents.navigationHistory.canGoBack()) {
      const wait = this.waitForNavigation(tab);
      webContents.navigationHistory.goBack();
      await wait;
    }
    if (direction === "forward" && webContents.navigationHistory.canGoForward()) {
      const wait = this.waitForNavigation(tab);
      webContents.navigationHistory.goForward();
      await wait;
    }
    return {};
  }

  private closeTab(params: Record<string, unknown>): JsonValue {
    const tab = this.requireTab(params);
    tab.window.close();
    return {};
  }

  private async tabsContent(params: Record<string, unknown>): Promise<JsonValue> {
    const ids = Array.isArray(params.tab_ids) ? params.tab_ids.filter((value): value is string => typeof value === "string") : undefined;
    const tabs = ids?.length ? ids.map((id) => this.tabs.get(id)).filter((tab): tab is ManagedTab => Boolean(tab)) : Array.from(this.tabs.values());
    const results = [];
    for (const tab of tabs) {
      const text = await tab.window.webContents.executeJavaScript("document.documentElement.innerText", true).catch(() => "");
      results.push({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        text: typeof text === "string" ? text : "",
      });
    }
    return { tabs: results };
  }

  private async executeCdp(params: Record<string, unknown>): Promise<JsonValue> {
    const method = this.readString(params, "method");
    const commandParams = this.readRecord(params, "commandParams");
    const target = this.readRecord(params, "target");
    const tabId = this.readString(target, "tabId") ?? (typeof target.tabId === "number" ? String(target.tabId) : undefined);
    if (method === "Target.getTargets") {
      return {
        targetInfos: Array.from(this.tabs.values(), (tab) => ({
          targetId: tab.id,
          type: "page",
          title: tab.title,
          url: tab.url,
          attached: true,
        })),
      };
    }

    if (method?.endsWith(".enable") || method === "Emulation.setFocusEmulationEnabled") {
      return {};
    }

    if (method === "Page.getFrameTree") {
      const tab = this.requireTab({ tab_id: tabId });
      return {
        frameTree: {
          frame: {
            id: tab.id,
            url: tab.window.webContents.getURL() || tab.url,
          },
        },
      };
    }

    if (method === "Page.navigate") {
      const tab = this.requireTab({ tab_id: tabId });
      const url = this.readString(commandParams, "url");
      if (!url) {
        throw new Error("Page.navigate requires commandParams.url");
      }

      this.recordNavigation(tab, url);
      return { frameId: tab.id };
    }

    if (method === "Page.reload") {
      const tab = this.requireTab({ tab_id: tabId });
      await this.reloadTab({ tab_id: tab.id });
      return {};
    }

    if (method === "Page.getNavigationHistory") {
      const tab = this.requireTab({ tab_id: tabId });
      return {
        currentIndex: 0,
        entries: [
          {
            id: 1,
            title: tab.window.webContents.getTitle() || tab.title,
            url: tab.window.webContents.getURL() || tab.url,
          },
        ],
      };
    }

    if (method === "Runtime.evaluate") {
      const tab = this.requireTab({ tab_id: tabId });
      const expression = this.readString(commandParams, "expression") ?? "";
      if (expression.includes("window.location.href") && expression.includes("document.readyState")) {
        return {
          result: {
            type: "object",
            value: {
              href: tab.window.webContents.getURL() || tab.url,
              readyState: await tab.window.webContents.executeJavaScript("document.readyState", true).catch(() => "complete"),
            },
          },
        };
      }
      if (expression.includes("document.title")) {
        return {
          result: {
            type: "string",
            value: tab.window.webContents.getTitle() || tab.title,
          },
        };
      }
      return {
        result: {
          type: "undefined",
        },
      };
    }

    throw new Error(`Unsupported BotPilot CDP method: ${method ?? "[missing]"}`);
  }

  private requireTab(params: Record<string, unknown>): ManagedTab {
    const tabId = this.readString(params, "tab_id") ?? this.readString(params, "tabId") ?? this.selectedTabId;
    const tab = tabId ? this.tabs.get(tabId) : undefined;
    if (!tab) {
      throw new Error(`BotPilot browser tab is not available: ${tabId ?? "[missing]"}`);
    }

    this.selectedTabId = tab.id;
    return tab;
  }

  private async loadUrl(tab: ManagedTab, url: string): Promise<void> {
    this.emitCdpEvent(tab.id, "Page.frameStartedLoading", { frameId: tab.id });
    const wait = this.waitForNavigation(tab);
    await tab.window.loadURL(url);
    await wait;
    const currentUrl = tab.window.webContents.getURL() || url;
    this.emitCdpEvent(tab.id, "Page.frameNavigated", {
      frame: {
        id: tab.id,
        url: currentUrl,
      },
    });
    this.emitCdpEvent(tab.id, "Page.domContentEventFired", {});
    this.emitCdpEvent(tab.id, "Page.loadEventFired", {});
  }

  private recordNavigation(tab: ManagedTab, url: string): void {
    tab.url = url;
    tab.title = this.deriveTitle(url);
    this.emitCdpEvent(tab.id, "Page.frameStartedLoading", { frameId: tab.id });
    this.emitCdpEvent(tab.id, "Page.frameNavigated", {
      frame: {
        id: tab.id,
        url,
      },
    });
    this.emitCdpEvent(tab.id, "Page.domContentEventFired", {});
    this.emitCdpEvent(tab.id, "Page.loadEventFired", {});
  }

  private deriveTitle(url: string): string {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      if (hostname === "instagram.com") {
        return "Instagram";
      }
      return hostname || url;
    } catch {
      return url;
    }
  }

  private waitForNavigation(tab: ManagedTab): Promise<void> {
    return new Promise((resolve) => {
      const webContents = tab.window.webContents;
      const timeout = setTimeout(done, 20_000);

      function done(): void {
        clearTimeout(timeout);
        webContents.off("did-finish-load", done);
        webContents.off("did-fail-load", done);
        webContents.off("did-stop-loading", done);
        resolve();
      }

      webContents.once("did-finish-load", done);
      webContents.once("did-fail-load", done);
      webContents.once("did-stop-loading", done);
    });
  }

  private toBrowserUseTab(tab: ManagedTab): BrowserUseTab {
    return {
      id: tab.id,
      url: tab.window.webContents.getURL() || tab.url,
      title: tab.window.webContents.getTitle() || tab.title,
    };
  }

  private readString(params: Record<string, unknown>, key: string): string | undefined {
    const value = params[key];
    return typeof value === "string" && value.length ? value : undefined;
  }

  private readRecord(params: Record<string, unknown>, key: string): Record<string, unknown> {
    const value = params[key];
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private emitCdpEvent(tabId: string, method: string, params: Record<string, unknown>): void {
    this.writeNotification("onCDPEvent", {
      source: {
        tabId: Number(tabId),
      },
      method,
      params,
    });
  }

  private writeNotification(method: string, params: JsonValue): void {
    for (const socket of this.sockets) {
      this.writePayload(socket, {
        jsonrpc: "2.0",
        method,
        params,
      });
    }
  }

  private writeResponse(socket: net.Socket, id: string | number | null, result?: JsonValue, error?: unknown): void {
    const payload = error
      ? {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
          },
        }
      : {
          jsonrpc: "2.0",
          id,
          result,
        };
    this.writePayload(socket, payload);
  }

  private writePayload(socket: net.Socket, payload: JsonValue): void {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    socket.write(Buffer.concat([header, body]));
  }
}
