import { normalizeCommands } from "./event-page-compiler.ts";

/**
 * 事件契约的「人话剧本」渲染器 —— 与 event-page-compiler 同源的另一副面孔。
 *
 * 同一份抽象 `implementation.commands[]`：compiler 翻成 RMMV 命令码给引擎跑，
 * 本模块翻成结构化剧本行给人读。放置前展示用，使用户无需放置 + 右键打开事件即可审稿。
 *
 * 关键：渲染前先跑 `normalizeCommands`（确定性归一，与放置/编译同一步），
 * 保证「读到的台词与分支」= 将来编译进地图的内容，不漂移。
 * 词表必须与 compiler 的 `KNOWN_COMMAND_KINDS` 对齐：compiler 增删 case 时同步改这里。
 */

export interface EventScriptLine {
  /** 缩进层级（选项分支 / 条件分支体 +1）。 */
  indent: number;
  kind:
    | "dialogue"
    | "choice-prompt"
    | "choice-option"
    | "branch"
    | "effect"
    | "stage"
    | "comment";
  /** 主文本（对白保留原始换行，前端 pre-line 渲染）。 */
  text: string;
  /** 对白说话人（取 faceName）；无则不显示前缀。 */
  speaker?: string;
  /** 行首小图标提示（emoji）。 */
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

interface ContractLike {
  id?: string;
  rmmvTarget?: { trigger?: string; eventName?: string } | null;
  implementation?: { commands?: unknown[]; pages?: unknown[] } | null;
}

type Cmd = Record<string, unknown>;

const TRIGGER_LABELS: Record<string, string> = {
  "action-button": "调查触发",
  "player-touch": "碰触触发",
  "event-touch": "事件碰触",
  autorun: "自动执行",
  parallel: "并行执行",
};

const BALLOON_LABELS: Record<number, string> = {
  1: "!",
  2: "?",
  3: "♪",
  4: "❤",
  5: "怒",
  6: "汗",
  7: "烦躁",
  8: "…",
  9: "灵感",
  10: "Zzz",
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** value===false 视为「关」，其余（含缺省）视为「开」，与 compiler 的 `value===false?1:0` 对齐。 */
function onOff(value: unknown): string {
  return value === false ? "关" : "开";
}

/** 把契约 implementation 规范成抽象页数组（顶层 commands[] 视作单页）。 */
function toPages(impl: ContractLike["implementation"], defaultTrigger?: string): Cmd[] {
  if (!impl || typeof impl !== "object") return [];
  const pages = Array.isArray(impl.pages) ? (impl.pages as Cmd[]) : null;
  if (pages && pages.some((page) => page && Array.isArray((page as Cmd).commands))) {
    return pages;
  }
  if (Array.isArray(impl.commands) && impl.commands.length) {
    const page: Cmd = { commands: impl.commands };
    if (defaultTrigger) page.trigger = defaultTrigger;
    return [page];
  }
  return [];
}

function branchConditionLabel(condition: Cmd | undefined): string {
  if (!condition || typeof condition !== "object") return "条件成立";
  const kind = str(condition.kind);
  if (kind === "switch") return `开关 #${num(condition.id) ?? "?"} ${onOff(condition.value)}`;
  if (kind === "variable") {
    return `变量 #${num(condition.id) ?? "?"} ${str(condition.operator) || ">="} ${num(condition.value) ?? 0}`;
  }
  if (kind === "self-switch") return `自开关 ${str(condition.name) || "?"} ${onOff(condition.value)}`;
  return "条件成立";
}

function pageConditionLabel(conditions: unknown): string | undefined {
  if (!conditions || typeof conditions !== "object") return undefined;
  const cond = conditions as Cmd;
  const parts: string[] = [];
  if (typeof cond.selfSwitch === "string") parts.push(`自开关 ${cond.selfSwitch}=开`);
  if (Array.isArray(cond.switchIds) && cond.switchIds.length) {
    parts.push(`开关 ${(cond.switchIds as number[]).map((id) => `#${id}`).join("、")}=开`);
  }
  const variable = cond.variable as Cmd | undefined;
  if (variable && typeof variable === "object") {
    parts.push(`变量 #${num(variable.id) ?? "?"} ≥ ${num(variable.min) ?? 0}`);
  }
  return parts.length ? `需 ${parts.join("，")}` : undefined;
}

function moveTargetLabel(target: unknown): string {
  if (target === undefined || target === "this-event") return "本事件";
  if (target === "player") return "玩家";
  const id = num(target);
  if (id) return `事件 #${id}`;
  const eventId = target && typeof target === "object" ? num((target as Cmd).eventId) : undefined;
  return eventId ? `事件 #${eventId}` : "本事件";
}

function pushCommands(lines: EventScriptLine[], commands: unknown, indent: number): void {
  if (!Array.isArray(commands)) return;
  for (const raw of commands) {
    if (!raw || typeof raw !== "object") continue;
    pushCommand(lines, raw as Cmd, indent);
  }
}

function pushCommand(lines: EventScriptLine[], cmd: Cmd, indent: number): void {
  const kind = str(cmd.kind);
  switch (kind) {
    case "comment": {
      const text = str(cmd.text);
      // AIWF:* 是给机器看的锚点/标记，剧本里不展示。
      if (!text || /^AIWF:/.test(text.trim())) return;
      lines.push({ indent, kind: "comment", text, icon: "※" });
      return;
    }
    case "text": {
      const text = str(cmd.text);
      if (!text.trim()) return;
      lines.push({ indent, kind: "dialogue", text, speaker: str(cmd.faceName) || undefined });
      return;
    }
    case "choice": {
      lines.push({ indent, kind: "choice-prompt", text: "玩家选择", icon: "❓" });
      const choices = Array.isArray(cmd.choices) ? (cmd.choices as unknown[]) : [];
      for (const choice of choices) {
        const optText = typeof choice === "string" ? choice : str((choice as Cmd)?.text);
        lines.push({ indent, kind: "choice-option", text: optText || "（空选项）", icon: "▸" });
        if (choice && typeof choice === "object") {
          pushCommands(lines, (choice as Cmd).commands, indent + 1);
        }
      }
      return;
    }
    case "conditional-branch": {
      lines.push({ indent, kind: "branch", text: `如果 ${branchConditionLabel(cmd.condition as Cmd)}`, icon: "🔀" });
      pushCommands(lines, cmd.then ?? cmd.commands, indent + 1);
      if (Array.isArray(cmd.else) && cmd.else.length) {
        lines.push({ indent, kind: "branch", text: "否则", icon: "🔀" });
        pushCommands(lines, cmd.else, indent + 1);
      }
      return;
    }
    case "loop": {
      lines.push({ indent, kind: "branch", text: "循环", icon: "🔁" });
      pushCommands(lines, cmd.commands, indent + 1);
      return;
    }
    case "break-loop":
      lines.push({ indent, kind: "stage", text: "跳出循环", icon: "⛒" });
      return;
    case "wait":
      lines.push({ indent, kind: "stage", text: `停顿 ${num(cmd.frames) ?? 0} 帧`, icon: "⏸" });
      return;
    case "show-balloon": {
      const label = BALLOON_LABELS[num(cmd.balloonId) ?? -1] || `#${num(cmd.balloonId) ?? "?"}`;
      lines.push({ indent, kind: "stage", text: `头顶气泡 ${label}`, icon: "💬" });
      return;
    }
    case "play-se":
      lines.push({ indent, kind: "stage", text: `音效 ${str(cmd.name) || "?"}`, icon: "🔊" });
      return;
    case "move-route":
      lines.push({ indent, kind: "stage", text: `${moveTargetLabel(cmd.target)} 移动`, icon: "🚶" });
      return;
    case "show-animation":
      lines.push({ indent, kind: "stage", text: `播放动画 #${num(cmd.animationId) ?? "?"}`, icon: "✨" });
      return;
    case "screen-tint":
      lines.push({ indent, kind: "stage", text: "画面色调变化", icon: "🎨" });
      return;
    case "screen-flash":
      lines.push({ indent, kind: "stage", text: "闪屏", icon: "⚡" });
      return;
    case "screen-shake":
      lines.push({ indent, kind: "stage", text: "震屏", icon: "📳" });
      return;
    case "fadeout":
      lines.push({ indent, kind: "stage", text: "画面渐黑", icon: "🌑" });
      return;
    case "fadein":
      lines.push({ indent, kind: "stage", text: "画面渐亮", icon: "🌕" });
      return;
    case "transfer":
      lines.push({
        indent,
        kind: "stage",
        text: `传送 → 地图 #${num(cmd.mapId) ?? "?"} (${num(cmd.x) ?? "?"}, ${num(cmd.y) ?? "?"})`,
        icon: "🚪",
      });
      return;
    case "common-event":
      lines.push({ indent, kind: "stage", text: `调用公共事件 #${num(cmd.id) ?? "?"}`, icon: "🔗" });
      return;
    case "plugin":
      lines.push({ indent, kind: "stage", text: `插件指令 ${str(cmd.command)}`, icon: "🔌" });
      return;
    case "self-switch":
      lines.push({ indent, kind: "effect", text: `自开关 ${str(cmd.name) || "?"} = ${onOff(cmd.value)}`, icon: "⚙" });
      return;
    case "switch":
      lines.push({ indent, kind: "effect", text: `开关 #${num(cmd.id) ?? "?"} = ${onOff(cmd.value)}`, icon: "⚙" });
      return;
    case "variable":
      lines.push({ indent, kind: "effect", text: `变量 #${num(cmd.id) ?? "?"} = ${num(cmd.value) ?? 0}`, icon: "🔢" });
      return;
    case "change-gold": {
      const value = num(cmd.value) ?? 0;
      const sign = cmd.operation === "decrease" || value < 0 ? "−" : "+";
      lines.push({ indent, kind: "effect", text: `金钱 ${sign}${Math.abs(value)}`, icon: "💰" });
      return;
    }
    case "change-items": {
      const value = num(cmd.value) ?? 0;
      const sign = cmd.operation === "decrease" || value < 0 ? "−" : "+";
      lines.push({ indent, kind: "effect", text: `道具 #${num(cmd.itemId) ?? "?"} ${sign}${Math.abs(value)}`, icon: "🎒" });
      return;
    }
    default:
      // 未知 kind：归一化后仍然认不得，直接据实标出，便于发现词表缺口（fail-loud，不静默吞）。
      lines.push({ indent, kind: "stage", text: `未知命令 ${kind || "(空)"}`, icon: "⚠" });
      return;
  }
}

/** 把一份事件契约渲染成结构化剧本（多页）。 */
export function renderEventScript(contract: ContractLike | null | undefined): EventScriptModel {
  const safe: ContractLike = contract && typeof contract === "object" ? contract : {};
  const target = safe.rmmvTarget || {};
  const defaultTrigger = target.trigger;
  const rawPages = toPages(safe.implementation, defaultTrigger);
  const pages: EventScriptPage[] = rawPages.map((page, index) => {
    const { commands } = normalizeCommands(Array.isArray(page.commands) ? page.commands : []);
    const lines: EventScriptLine[] = [];
    pushCommands(lines, commands, 0);
    if (!lines.length) lines.push({ indent: 0, kind: "comment", text: "（本页无可见演出，仅条件或标记）", icon: "※" });
    const trigger = str(page.trigger) || str(defaultTrigger);
    return {
      index,
      triggerLabel: TRIGGER_LABELS[trigger] || trigger || "调查触发",
      conditionLabel: pageConditionLabel(page.conditions),
      lines,
    };
  });
  return {
    contractId: str(safe.id),
    eventName: str(target.eventName) || str(safe.id) || undefined,
    pages,
  };
}
