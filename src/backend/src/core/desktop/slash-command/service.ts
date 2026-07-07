import type { ProductLanguage } from "../../../../../contract/types.ts";
import { backendText } from "../../i18n/messages.ts";
import { resolveProjectPath } from "../project-service.ts";
import {
  aggregateAssistantTokenUsage,
  calculateContextPercent,
  latestAssistantContextTokens,
} from "./opencode-token-usage.ts";
import { getSlashCommand, listSlashCommands } from "./registry.ts";
import type { SlashCommandListItem, SlashCommandResult } from "./types.ts";
import {
  compactOpencodeSession,
  fetchOpencodeModelLimit,
  fetchOpencodeSessionMessages,
  type OpencodeSessionActionInput,
} from "../../workflow/agent/opencode/runtime.ts";

const TERMINAL_STATUSES = new Set([
  "pass",
  "blocked",
  "failed",
  "error",
  "stopped",
  "interrupted",
  "timeout",
]);

const STOP_WAIT_TIMEOUT_MS = 30_000;
const STOP_POLL_INTERVAL_MS = 200;

export interface SlashCommandSession {
  id: string;
  status: string;
  project: string;
  opencodeSessionId: string | null;
  productLanguage: ProductLanguage;
  providerId: string;
  modelId: string;
  opencodeRunContext?: {
    env?: Record<string, string>;
    config?: Record<string, unknown>;
  } | null;
}

export interface SlashCommandRuntime {
  workflowRoot: string;
  getSession(sessionId: string): SlashCommandSession | null;
  stopSession(sessionId: string): void;
  fetchMessages?: typeof fetchOpencodeSessionMessages;
  fetchModelLimit?: typeof fetchOpencodeModelLimit;
  compactSession?: typeof compactOpencodeSession;
}

function buildOpencodeActionInput(
  runtime: SlashCommandRuntime,
  session: SlashCommandSession,
): OpencodeSessionActionInput {
  const opencodeSessionId = session.opencodeSessionId?.trim();
  if (!opencodeSessionId) {
    throw new Error("missing opencode session");
  }
  return {
    workflowRoot: runtime.workflowRoot,
    cwd: resolveProjectPath(runtime.workflowRoot, session.project),
    opencodeSessionId,
    providerId: session.providerId,
    modelId: session.modelId,
    env: session.opencodeRunContext?.env ?? {},
    config: session.opencodeRunContext?.config ?? {},
  };
}

async function waitForSessionTerminal(getStatus: () => string): Promise<void> {
  const started = Date.now();
  while (!TERMINAL_STATUSES.has(getStatus())) {
    if (Date.now() - started > STOP_WAIT_TIMEOUT_MS) {
      throw new Error("timed out waiting for session to stop before compact");
    }
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_INTERVAL_MS));
  }
}

function localized(
  language: ProductLanguage,
  key: string,
  params?: Record<string, string | number>,
): string {
  return backendText(key as never, language, params as never);
}

function helpResult(language: ProductLanguage): SlashCommandResult {
  const lines = listSlashCommands().map((command) => {
    const description = localized(language, command.descriptionKey);
    return `/${command.name} — ${description}`;
  });
  return {
    ok: true,
    display: "composer_hint",
    message: lines.join("\n"),
    messageKey: "slash.help.body",
  };
}

function unknownResult(language: ProductLanguage, command: string): SlashCommandResult {
  return {
    ok: false,
    display: "composer_hint",
    message: localized(language, "slash.unknown", { command }),
    messageKey: "slash.unknown",
    messageParams: { command },
  };
}

function noSessionResult(language: ProductLanguage): SlashCommandResult {
  return {
    ok: false,
    display: "composer_hint",
    message: localized(language, "slash.tokens.noSession"),
    messageKey: "slash.tokens.noSession",
  };
}

function commandFailureResult(
  language: ProductLanguage,
  key: string,
  params?: Record<string, string | number>,
): SlashCommandResult {
  return {
    ok: false,
    display: "composer_hint",
    message: localized(language, key, params),
    messageKey: key,
    messageParams: params,
  };
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SlashCommandService {
  private readonly runtime: SlashCommandRuntime;

  constructor(runtime: SlashCommandRuntime) {
    this.runtime = runtime;
  }

  listCommands(): SlashCommandListItem[] {
    return listSlashCommands();
  }

  async execute(input: {
    sessionId: string;
    command: string;
    args?: string;
  }): Promise<SlashCommandResult> {
    const session = this.runtime.getSession(input.sessionId);
    if (!session) {
      throw new Error(`session not found: ${input.sessionId}`);
    }

    const language = session.productLanguage;
    const definition = getSlashCommand(input.command);
    if (!definition) {
      return unknownResult(language, input.command);
    }

    if (definition.name === "help") {
      return helpResult(language);
    }

    if (definition.name === "tokens") {
      return this.executeTokens(session, language);
    }

    if (definition.name === "compact") {
      return this.executeCompact(session, language);
    }

    return unknownResult(language, input.command);
  }

  private async executeTokens(
    session: SlashCommandSession,
    language: ProductLanguage,
  ): Promise<SlashCommandResult> {
    if (!session.opencodeSessionId?.trim()) {
      return noSessionResult(language);
    }
    if (!session.providerId?.trim() || !session.modelId?.trim()) {
      return commandFailureResult(language, "slash.tokens.noModel");
    }

    const fetchMessages = this.runtime.fetchMessages ?? fetchOpencodeSessionMessages;
    const fetchModelLimit = this.runtime.fetchModelLimit ?? fetchOpencodeModelLimit;
    try {
      const actionInput = buildOpencodeActionInput(this.runtime, session);
      const messages = await fetchMessages(actionInput);
      const aggregate = aggregateAssistantTokenUsage(messages);
      const snapshot = latestAssistantContextTokens(messages);
      const modelLimit = await fetchModelLimit({
        ...actionInput,
        providerId: snapshot.providerId ?? actionInput.providerId,
        modelId: snapshot.modelId ?? actionInput.modelId,
      });
      const contextUsedTokens = snapshot.usedTokens;
      const contextWindowTokens = modelLimit.context;
      const contextPercent = calculateContextPercent(contextUsedTokens, contextWindowTokens);
      const data = {
        ...aggregate,
        contextUsedTokens,
        contextWindowTokens,
        contextPercent,
      };
      return {
        ok: true,
        display: "composer_hint",
        message: localized(language, "slash.tokens.summary", {
          percent: contextPercent,
          used: contextUsedTokens,
          limit: contextWindowTokens,
        }),
        messageKey: "slash.tokens.summary",
        messageParams: {
          percent: contextPercent,
          used: contextUsedTokens,
          limit: contextWindowTokens,
        },
        data,
      };
    } catch (error) {
      return commandFailureResult(language, "slash.tokens.failed", { reason: errorReason(error) });
    }
  }

  private async executeCompact(
    session: SlashCommandSession,
    language: ProductLanguage,
  ): Promise<SlashCommandResult> {
    if (!session.opencodeSessionId?.trim()) {
      return noSessionResult(language);
    }

    // v1 summarize 必须传 providerID/modelID；session 没绑定模型时 fail-fast，
    // 避免把空值送到 opencode 再收一个 400 InvalidRequestError。
    if (!session.providerId?.trim() || !session.modelId?.trim()) {
      return {
        ok: false,
        display: "chat_status",
        message: localized(language, "slash.compact.noModel"),
        messageKey: "slash.compact.noModel",
      };
    }

    if (!TERMINAL_STATUSES.has(session.status)) {
      this.runtime.stopSession(session.id);
      await waitForSessionTerminal(() => this.runtime.getSession(session.id)?.status || session.status);
    }

    const compactSession = this.runtime.compactSession ?? compactOpencodeSession;
    try {
      await compactSession(buildOpencodeActionInput(this.runtime, session));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        display: "chat_status",
        message: localized(language, "slash.compact.failed", { reason }),
        messageKey: "slash.compact.failed",
        messageParams: { reason },
      };
    }

    return {
      ok: true,
      display: "chat_status",
      message: localized(language, "slash.compact.done"),
      messageKey: "slash.compact.done",
    };
  }
}
