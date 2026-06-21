import type { ProductLanguage } from '../../../../contract/i18n.ts';

/** Agent-facing prompt skeleton is fixed English regardless of UI language. */
export const AGENT_PROMPT_LANGUAGE = 'en-US' satisfies ProductLanguage;
