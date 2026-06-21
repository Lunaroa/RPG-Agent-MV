import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  approveIntent,
  buildPlanModePrefix,
  placementAllPlacedFollowUp,
  planModePrefix,
} from './agentIntent.ts';

describe('agentIntent', () => {
  it('builds fixed English plan mode prefix', () => {
    const text = buildPlanModePrefix('.opencode/plans/conversations/root.md');
    assert.match(text, /\[opencode plan mode is enabled\]/);
    assert.match(text, /Session plan file: \.opencode\/plans\/conversations\/root\.md/);
  });

  it('uses pending plan path placeholder when path is empty', () => {
    const text = planModePrefix('AGENT_RPG_SESSION_PLAN_PATH');
    assert.match(text, /AGENT_RPG_SESSION_PLAN_PATH/);
  });

  it('formats approve intent in English', () => {
    const text = approveIntent({
      askId: 'ask-1',
      type: 'plan-approval',
      title: 'Inn plan',
      planMarkdown: '# Plan',
    } as never);
    assert.match(text, /askId=ask-1/);
    assert.match(text, /Original plan title: Inn plan/);
  });

  it('formats placement follow-up in English', () => {
    assert.match(placementAllPlacedFollowUp(), /All required events have been placed/);
  });
});
