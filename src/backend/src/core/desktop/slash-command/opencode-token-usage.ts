import type { SlashCommandTokenData } from "./types.ts";

interface AssistantTokenMessage {
  role?: string;
  providerID?: string;
  providerId?: string;
  modelID?: string;
  modelId?: string;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: {
      read?: number;
      write?: number;
    };
  };
}

export interface AssistantContextTokenSnapshot {
  usedTokens: number;
  providerId?: string;
  modelId?: string;
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function tokenTotal(message: AssistantTokenMessage): number {
  const tokens = message.tokens;
  if (!tokens) return 0;
  return (
    finiteNumber(tokens.input)
    + finiteNumber(tokens.output)
    + finiteNumber(tokens.reasoning)
    + finiteNumber(tokens.cache?.read)
    + finiteNumber(tokens.cache?.write)
  );
}

export function latestAssistantContextTokens(messages: AssistantTokenMessage[]): AssistantContextTokenSnapshot {
  const last = messages.findLast((message) => (
    message.role === "assistant"
    && finiteNumber(message.tokens?.output) > 0
  ));

  if (!last) {
    return { usedTokens: 0 };
  }

  return {
    usedTokens: tokenTotal(last),
    providerId: stringValue(last.providerID) ?? stringValue(last.providerId),
    modelId: stringValue(last.modelID) ?? stringValue(last.modelId),
  };
}

export function calculateContextPercent(usedTokens: number, contextWindowTokens: number): number {
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
    throw new Error("opencode model context limit is missing");
  }
  return Math.round((Math.max(0, usedTokens) / contextWindowTokens) * 100);
}

export function aggregateAssistantTokenUsage(messages: AssistantTokenMessage[]): SlashCommandTokenData {
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalCost = 0;
  let turnCount = 0;

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (tokenTotal(message) <= 0) continue;

    const tokens = message.tokens ?? {};
    inputTokens += finiteNumber(tokens.input);
    outputTokens += finiteNumber(tokens.output);
    reasoningTokens += finiteNumber(tokens.reasoning);
    cacheRead += finiteNumber(tokens.cache?.read);
    cacheWrite += finiteNumber(tokens.cache?.write);
    totalCost += finiteNumber(message.cost);
    turnCount += 1;
  }

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheRead,
    cacheWrite,
    totalTokens: inputTokens + outputTokens + reasoningTokens + cacheRead + cacheWrite,
    totalCost,
    turnCount,
  };
}
