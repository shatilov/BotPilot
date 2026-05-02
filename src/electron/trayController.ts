import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron";
import type { BackgroundRuntime } from "./backgroundRuntime";

export interface TrayControllerOptions {
  getWindow: () => BrowserWindow | undefined;
  createWindow: () => Promise<BrowserWindow>;
  openSettingsWindow: () => Promise<BrowserWindow>;
  runtime: BackgroundRuntime;
  quit: () => void;
}

export class TrayController {
  private tray: Tray | undefined;

  constructor(private readonly options: TrayControllerOptions) {}

  create(): void {
    if (this.tray) {
      return;
    }

    this.tray = new Tray(createTrayImage());
    this.tray.setToolTip("Assyst Daemon");
    this.tray.on("click", () => {
      void this.showWindow();
    });
    this.updateMenu();
  }

  updateMenu(): void {
    if (!this.tray) {
      return;
    }

    const status = this.options.runtime.status();
    const lastTickLabel = status.lastTickAt
      ? `Last tick: ${new Date(status.lastTickAt).toLocaleTimeString()}`
      : "Last tick: never";
    const nextTickLabel = status.nextTickAt
      ? `Next tick: ${new Date(status.nextTickAt).toLocaleTimeString()}`
      : "Next tick: pending";
    const telegramLabel = formatTelegramStatus(status.lastResult);

    const menu = Menu.buildFromTemplate([
      {
        label: status.running ? "Assyst Daemon: running" : "Assyst Daemon: stopped",
        enabled: false,
      },
      {
        label: lastTickLabel,
        enabled: false,
      },
      {
        label: nextTickLabel,
        enabled: false,
      },
      {
        label: telegramLabel,
        enabled: false,
      },
      ...(status.lastError
        ? [
            {
              label: `Last error: ${status.lastError}`,
              enabled: false,
            } as const,
          ]
        : []),
      { type: "separator" },
      {
        label: "Show Window",
        click: () => {
          void this.showWindow();
        },
      },
      {
        label: "Settings...",
        click: () => {
          void this.options.openSettingsWindow();
        },
      },
      {
        label: status.running ? "Pause Background Work" : "Resume Background Work",
        click: () => {
          if (status.running) {
            this.options.runtime.stop();
          } else {
            this.options.runtime.start();
          }
          this.updateMenu();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => this.options.quit(),
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }

  private async showWindow(): Promise<void> {
    const window = this.options.getWindow() ?? (await this.options.createWindow());
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }
}

function formatTelegramStatus(result: Record<string, unknown> | undefined): string {
  if (!result || result.transport !== "telegram") {
    return "Telegram: idle";
  }

  if (!result.configured) {
    return "Telegram: not configured";
  }

  return [
    "Telegram:",
    `fetched ${String(result.fetched ?? 0)}`,
    `processed ${String(result.processed ?? 0)}`,
    `answered ${String(result.answered ?? 0)}`,
  ].join(" ");
}

function createTrayImage(): Electron.NativeImage {
  if (process.platform === "darwin") {
    const image = nativeImage.createFromNamedImage("NSActionTemplate");
    image.setTemplateImage(true);
    return image;
  }

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">',
    '<rect width="32" height="32" rx="7" fill="#172033"/>',
    '<path d="M9 23L15.2 8H17L23 23H20.6L19.2 19.3H12.8L11.4 23H9ZM13.6 17.2H18.4L16 10.8L13.6 17.2Z" fill="#FFFFFF"/>',
    "</svg>",
  ].join("");

  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}
