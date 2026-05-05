const EXACT_RESTART_REQUESTS = new Set([
  "restart",
  "restart app",
  "restart botpilot",
  "restart assyst",
  "restart daemon",
  "restart service",
  "restart yourself",
  "рестарт",
  "перезапустись",
  "перезапусти botpilot",
  "перезапусти assyst",
  "перезапусти daemon",
  "перезапусти ассистента",
  "перезапусти демона",
  "перезапусти приложение",
  "перезапусти сервис",
  "перезапусти себя",
  "перезагрузи botpilot",
  "перезагрузи assyst",
  "перезагрузи daemon",
  "перезагрузи ассистента",
  "перезагрузи демона",
  "перезагрузи приложение",
  "перезагрузи сервис",
  "перезагрузи себя",
]);

const RESTART_SLASH_COMMANDS = new Set([
  "/restart",
  "/restart_app",
  "/restart_botpilot",
  "/restart_assyst",
  "/restart_daemon",
]);

const NEGATION_PATTERNS = [
  /\bdo\s+not\s+restart\b/u,
  /\bdon['’]?t\s+restart\b/u,
  /\bdont\s+restart\b/u,
  /\bnot\s+restart\b/u,
  /\bне\s+перезапуска/u,
  /\bне\s+перезагру/u,
  /\bне\s+рестарт/u,
];

export function isExplicitRestartRequest(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized || NEGATION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  const firstToken = normalized.split(" ")[0]?.replace(/@[a-z0-9_]+$/u, "");
  if (firstToken && RESTART_SLASH_COMMANDS.has(firstToken)) {
    return true;
  }

  return EXACT_RESTART_REQUESTS.has(stripPoliteSuffix(normalized));
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[.!?]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function stripPoliteSuffix(text: string): string {
  return text
    .replace(/\s+(please|pls|пожалуйста)$/u, "")
    .trim();
}
