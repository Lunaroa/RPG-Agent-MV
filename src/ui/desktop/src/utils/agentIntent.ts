import type { Ask } from './askParser';

const PLAN_PATH_PENDING =
  'the file specified by AGENT_RPG_SESSION_PLAN_PATH (resolved after the first turn in this conversation)';

export function planModePrefix(planTarget: string): string {
  return [
    '[opencode plan mode is enabled]',
    `Use the plan agent: write the plan to ${planTarget} only for this conversation with write/edit tools. Do not read or modify plan files for other conversations. Do not write plans to logs/tmp or PLAN.md at the project root. Ask clarifying questions with AskUserQuestion when needed; after the plan is ready, call plan_exit for approval. Do not perform write actions before approval.`,
    'AskUserQuestion is only for clarifying choice questions. Its input must be a questions array, with 2-4 options for each question.',
    'plan_exit approval is rendered by the desktop ASK card; do not replace it with plain text.',
    'For simple read-only questions, answer directly instead of forcing plan approval.',
    '',
  ].join('\n');
}

export function buildPlanModePrefix(planPath: string): string {
  const planTarget = planPath.trim() ? `Session plan file: ${planPath.trim()}` : PLAN_PATH_PENDING;
  return planModePrefix(planTarget);
}

export function approveIntent(ask: Ask): string {
  return [
    `The user approved the plan in Agent console, askId=${ask.askId}. Continue execution according to the approved plan.`,
    'Do not create another plan-approval ASK unless a new major change appears that was not covered by the approved plan.',
    'Original plan title: ' + (ask.title || ''),
    ask.planMarkdown ? 'Original plan:\n```markdown\n' + ask.planMarkdown + '\n```' : '',
  ].filter(Boolean).join('\n');
}

export function feedbackIntent(ask: Ask, decision: 'revise' | 'reject', feedback: string): string {
  if (decision === 'revise') {
    return [
      `The user requested changes to the plan in Agent console, askId=${ask.askId}.`,
      'Revise the plan according to the feedback below, then emit a new plan-approval ASK and wait for approval. Do not perform write actions directly.',
      'User feedback:',
      feedback,
      '',
      'Original plan:',
      '```markdown',
      ask.planMarkdown || '',
      '```',
    ].join('\n');
  }
  return [
    `The user rejected the plan in Agent console, askId=${ask.askId}.`,
    'Stop this direction, return to clarifying the current requirement, and do not continue executing the rejected plan.',
    'Rejection reason:',
    feedback,
  ].join('\n');
}

export function clarifyIntent(
  ask: Ask,
  payload: { answer: string; selected?: string[]; other?: string },
): string {
  const lines = [
    `The user answered a clarify ASK in Agent console, askId=${ask.askId}.`,
    ask.fieldName ? `Field: ${ask.fieldName}` : '',
  ];
  if (payload.selected?.length && ask.options?.length) {
    const labels = payload.selected.map((selectedId) => {
      if (selectedId === '__other__') {
        return payload.other ? `Other: ${payload.other}` : 'Other';
      }
      const opt = ask.options?.find((o) => o.id === selectedId);
      return opt ? (opt.label || opt.title || selectedId) : selectedId;
    }).filter(Boolean);
    lines.push('User selected: ' + (labels.join(', ') || payload.answer));
    if (payload.other && !payload.selected.includes('__other__')) {
      lines.push(`Additional note: ${payload.other}`);
    }
  } else {
    lines.push('User answer:', payload.answer);
  }
  lines.push('', 'Continue the previous work based on this answer.');
  return lines.filter(Boolean).join('\n');
}

export function multiChoiceIntent(
  ask: Ask,
  answers: Record<string, { selected: string[]; other: string }>,
): string {
  const lines = [
    `The user answered a multi-choice-clarify ASK in Agent console, askId=${ask.askId}.`,
    'Continue the previous work based on these answers. Do not ask the same clarify / multi-choice-clarify questions again.',
    '',
    'Title: ' + (ask.title || ''),
    '',
  ];
  for (const [idx, q] of (ask.questions || []).entries()) {
    const ans = answers[q.id] || { selected: [], other: '' };
    const labels = (ans.selected || []).map((sid) => {
      if (sid === '__other__') return ans.other ? `Other: ${ans.other}` : 'Other (not filled)';
      const opt = (q.options || []).find((o) => o.id === sid);
      return opt ? (opt.label || opt.title || sid) : sid;
    }).filter(Boolean);
    lines.push(`Q${idx + 1}: ${q.header || q.id}`);
    if (q.question) lines.push(`  Prompt: ${q.question}`);
    if (labels.length) lines.push(`  Selected: ${labels.join(', ')}`);
    if (ans.other && !ans.selected.includes('__other__')) lines.push(`  Additional note: ${ans.other}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function placementResultIntro(): string {
  return 'This is the manual event placement result from agent-console. Continue the previous step based on this result; do not ask the user to choose coordinates again, and do not treat unplaced events as written to the final map.';
}

export function placementAllPlacedFollowUp(): string {
  return 'All required events have been placed. Run the full block check immediately and continue validation according to the acceptance requirements.';
}

export function placementPartialFollowUp(): string {
  return 'Only part of the placement is complete. Save and inspect the current progress, then emit a clarify ASK asking the user to continue placing missing items, pause while keeping progress, or cancel this turn. When requesting placement again, show only missing or problematic events.';
}

export function productionBoardConfirmedPrompt(askId: string): string {
  return `The user confirmed the production board in Agent console, askId=${askId}. Bind maps, place events, and start execution according to the board.`;
}

export function mapSelectionUseExistingPrompt(askId: string, mapId: number): string {
  return `The user chose existing map #${mapId}, askId=${askId}. Continue with this exact map id.`;
}

export function mapSelectionAdjustStoryPrompt(askId: string): string {
  return `The user chose to adjust the story to fit existing maps, askId=${askId}. Adjust the scene requirements first; do not write the related event until the map issue is resolved.`;
}

export function formatPlacementResultIntent(ask: Ask): string {
  const events = (ask.events || []) as Array<Record<string, unknown>>;
  const result = {
    type: 'event-placement-result',
    askId: ask.askId,
    placedEvents: events.map((event) => ({
      contractId: event.contractId,
      eventName: event.eventName,
      mapId: event.targetMapId,
      eventId: event.placedEventId ?? null,
      x: Number.isInteger(event.x) ? event.x : null,
      y: Number.isInteger(event.y) ? event.y : null,
      status: event.status,
    })),
    modifications: ask.modifications || [],
  };
  return [placementResultIntro(), JSON.stringify(result, null, 2)].join('\n\n');
}
