import type { ProductLanguage } from "../../../../../contract/types.ts";
import { backendText } from "../../i18n/messages.ts";
import { resolveProjectPath } from "../project-service.ts";
import {
  resolveOpencodeActionBootstrap,
  type OpencodeActionBootstrapDeps,
} from "./opencode-action-bootstrap.ts";
import {
  aggregateAssistantTokenUsage,
  calculateContextPercent,
  latestAssistantContextTokens,
} from "./opencode-token-usage.ts";
import { getSlashCommand, listSlashCommands } from "./registry.ts";
import type {
  GetContextUsageResult,
  SlashCommandListItem,
  SlashCommandResult,
  SlashCommandTokenData,
} from "./types.ts";
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
  resolveBootstrap?: OpencodeActionBootstrapDeps;
}

async function buildOpencodeActionInput(
  runtime: SlashCommandRuntime,
  session: SlashCommandSession,
): Promise<OpencodeSessionActionInput> {
  const opencodeSessionId = session.opencodeSessionId?.trim();
  if (!opencodeSessionId) {
    throw new Error("missing opencode session");
  }
  const bootstrap = await resolveOpencodeActionBootstrap(
    runtime.workflowRoot,
    session,
    runtime.resolveBootstrap,
  );
  return {
    workflowRoot: runtime.workflowRoot,
    cwd: session.project?.trim()
      ? resolveProjectPath(runtime.workflowRoot, session.project)
      : runtime.workflowRoot,
    opencodeSessionId,
    providerId: session.providerId,
    modelId: session.modelId,
    env: bootstrap.env,
    config: bootstrap.config,
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

  async getContextUsage(sessionId: string): Promise<GetContextUsageResult> {
    const session = this.runtime.getSession(sessionId);
    if (!session) {
      throw new Error(`session not found: ${sessionId}`);
    }
    const resolved = await this.resolveContextUsage(session, session.productLanguage);
    if (!resolved.ok) {
      return {
        ok: false,
        message: resolved.message,
        messageKey: resolved.messageKey,
        messageParams: resolved.messageParams,
      };
    }
    return { ok: true, data: resolved.data };
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

  private async resolveContextUsage(
    session: SlashCommandSession,
    language: ProductLanguage,
  ): Promise<GetContextUsageResult & { aggregate?: SlashCommandTokenData }> {
    if (!session.opencodeSessionId?.trim()) {
      return {
        ok: false,
        message: localized(language, "slash.tokens.noSession"),
        messageKey: "slash.tokens.noSession",
      };
    }
    if (!session.providerId?.trim() || !session.modelId?.trim()) {
      return {
        ok: false,
        message: localized(language, "slash.tokens.noModel"),
        messageKey: "slash.tokens.noModel",
      };
    }

    const fetchMessages = this.runtime.fetchMessages ?? fetchOpencodeSessionMessages;
    const fetchModelLimit = this.runtime.fetchModelLimit ?? fetchOpencodeModelLimit;
    try {
      const actionInput = await buildOpencodeActionInput(this.runtime, session);
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
      return {
        ok: true,
        data: {
          contextUsedTokens,
          contextWindowTokens,
          contextPercent,
        },
        aggregate,
      };
    } catch (error) {
      return {
        ok: false,
        message: localized(language, "slash.tokens.failed", { reason: errorReason(error) }),
        messageKey: "slash.tokens.failed",
        messageParams: { reason: errorReason(error) },
      };
    }
  }

  private async executeTokens(
    session: SlashCommandSession,
    language: ProductLanguage,
  ): Promise<SlashCommandResult> {
    const resolved = await this.resolveContextUsage(session, language);
    if (!resolved.ok) {
      return {
        ok: false,
        display: "composer_hint",
        message: resolved.message,
        messageKey: resolved.messageKey,
        messageParams: resolved.messageParams,
      };
    }

    const { contextUsedTokens, contextWindowTokens, contextPercent } = resolved.data;
    const aggregate = resolved.aggregate ?? {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      turnCount: 0,
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
      data: {
        ...aggregate,
        contextUsedTokens,
        contextWindowTokens,
        contextPercent,
      },
    };
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
      await compactSession(await buildOpencodeActionInput(this.runtime, session));
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
