import { pickByLocale } from '../../../../contract/i18n.ts';

/** Agent-visible feedback review cards — fixed English for every locale. */
function fixedEnglish<T extends string>(text: T): Record<'zh-CN' | 'en-US', T> {
  return { 'zh-CN': text, 'en-US': text };
}

export function feedbackVerdictLabel(verdict: string): string {
  const labels = pickByLocale(null, {
    'zh-CN': {
      accept: '✅ Accept',
      revise: '✏️ Revise',
      reject: '❌ Reject',
    },
    'en-US': {
      accept: '✅ Accept',
      revise: '✏️ Revise',
      reject: '❌ Reject',
    },
  });
  return labels[verdict as keyof typeof labels] ?? verdict;
}

export function feedbackCardTitle(contractId: string): string {
  return pickByLocale(null, fixedEnglish(`# Feedback card: ${contractId}`));
}

export function feedbackCardSummary(verdict: string, count: number, generatedAt: string): string {
  return pickByLocale(null, fixedEnglish(
    `> Current verdict: **${verdict}** | ${count} feedback item(s) | Generated at ${generatedAt}`,
  ));
}

export function feedbackCardSections(): {
  scores: string;
  scoreTableHead: string;
  scoreTableRule: string;
  eventContract: string;
  fullContractSummary: string;
  missingContract: string;
  aiProcess: string;
  missingSession: string;
  thinking: string;
  thinkingSummary: string;
  toolCalls: string;
  assistantText: string;
} {
  return pickByLocale(null, {
    'zh-CN': {
      scores: '## Your scores',
      scoreTableHead: '| # | Verdict | Tags | Note | Time | Session |',
      scoreTableRule: '|---|---------|------|------|------|---------|',
      eventContract: '## Event content (EventContract)',
      fullContractSummary: '<details><summary>Full contract JSON</summary>',
      missingContract: '_(Contract is no longer in the registry; it may have been deleted or renamed.)_',
      aiProcess: '## AI generation trace',
      missingSession: '_(Latest feedback row has no --session; include a session id when recording to attach AI thinking and tool calls.)_',
      thinking: '### Thinking',
      thinkingSummary: '<details><summary>Expand reasoning chain</summary>',
      toolCalls: '### Tool calls',
      assistantText: '### AI outward explanation',
    },
    'en-US': {
      scores: '## Your scores',
      scoreTableHead: '| # | Verdict | Tags | Note | Time | Session |',
      scoreTableRule: '|---|---------|------|------|------|---------|',
      eventContract: '## Event content (EventContract)',
      fullContractSummary: '<details><summary>Full contract JSON</summary>',
      missingContract: '_(Contract is no longer in the registry; it may have been deleted or renamed.)_',
      aiProcess: '## AI generation trace',
      missingSession: '_(Latest feedback row has no --session; include a session id when recording to attach AI thinking and tool calls.)_',
      thinking: '### Thinking',
      thinkingSummary: '<details><summary>Expand reasoning chain</summary>',
      toolCalls: '### Tool calls',
      assistantText: '### AI outward explanation',
    },
  });
}

export function feedbackCardScoreRow(input: {
  id: number;
  verdict: string;
  tags: string;
  note: string;
  createdAt: string;
  sessionId: string;
}): string {
  return pickByLocale(null, fixedEnglish(
    `| ${input.id} | ${input.verdict} | ${input.tags} | ${input.note} | ${input.createdAt} | ${input.sessionId} |`,
  ));
}

export function feedbackCardPurpose(purpose: string): string {
  return pickByLocale(null, fixedEnglish(`**Purpose**: ${purpose}`));
}

export function feedbackCardCommandKinds(count: number, kinds: string): string {
  return pickByLocale(null, fixedEnglish(`**Command sequence** (${count}): ${kinds}`));
}

export function feedbackCardSessionEventsMissing(sessionId: string): string {
  return pickByLocale(null, fixedEnglish(
    `_(Session events for \`${sessionId}\` were not found; they may have been cleaned up by the runtime.)_`,
  ));
}

export function feedbackCardEventsSource(path: string): string {
  return pickByLocale(null, fixedEnglish(`> Source: \`${path}\` (opencode session events)`));
}

export function feedbackCardListSeparator(): string {
  return pickByLocale(null, fixedEnglish(', '));
}
