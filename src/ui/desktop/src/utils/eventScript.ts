// 事件契约「人话剧本」的前端类型与取数封装。
// 渲染逻辑在后端（与编译器同源），前端只负责展示 —— 见 backend/core/rmmv/event-script.ts。

export type EventScriptLineKind =
  | 'dialogue'
  | 'choice-prompt'
  | 'choice-option'
  | 'branch'
  | 'effect'
  | 'stage'
  | 'comment';

export interface EventScriptLine {
  indent: number;
  kind: EventScriptLineKind;
  text: string;
  speaker?: string;
  icon?: string;
}

export interface EventScriptPage {
  index: number;
  triggerLabel: string;
  conditionLabel?: string;
  lines: EventScriptLine[];
}

export interface EventScriptModel {
  contractId: string;
  eventName?: string;
  pages: EventScriptPage[];
}

export type EventScriptResult =
  | { status: 'ok'; script: EventScriptModel }
  | { status: 'not-found' | string; contractId?: string; script?: undefined };
