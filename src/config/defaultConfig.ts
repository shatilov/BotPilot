import type { MasterAgentConfig } from "../domain/types";

export const defaultConfig: MasterAgentConfig = {
  defaultProvider: "codex",
  workspaceRoot: process.cwd(),
  timeoutMs: 30 * 60 * 1000,
  agents: {
    codex: {
      type: "codex",
      bin: "codex",
      sandbox: "workspace-write",
      approvalPolicy: "never",
      extraArgs: ["--skip-git-repo-check"],
    },
    claude: {
      type: "claude",
      bin: "claude",
      permissionMode: "auto",
      outputFormat: "text",
      noSessionPersistence: true,
    },
  },
};
