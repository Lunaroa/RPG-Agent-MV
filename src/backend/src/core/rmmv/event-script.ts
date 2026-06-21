import { normalizeCommands } from "./event-page-compiler.ts";
import {
  eventScriptText,
  eventScriptTriggerLabels,
  eventScriptAnimationLabel,
  eventScriptBalloonLabel,
  eventScriptBranchConditionLabel,
  eventScriptCommonEventLabel,
  eventScriptGoldLabel,
  eventScriptIfLabel,
  eventScriptItemLabel,
  eventScriptMoveLabel,
  eventScriptPageConditionLabel,
  eventScriptPluginCommandLabel,
  eventScriptSelfSwitchLabel,
  eventScriptSoundEffectLabel,
  eventScriptSwitchLabel,
  eventScriptTransferLabel,
  eventScriptUnknownCommandLabel,
  eventScriptVariableLabel,
  eventScriptWaitLabel,
} from "./eventScriptLocalization.ts";

/**
 * Human-readable event script renderer backed by the same normalized command
 * model used by event-page-compiler.
 *
 * The compiler turns `implementation.commands[]` into RMMV command codes. This
 * module turns the same abstract commands into structured script lines for
 * pre-placement review.
 *
 * Rendering runs `normalizeCommands` first so reviewed dialogue/branches match
 * the content that will be compiled into the map.
 */

export interface EventScriptLine {
  /** Indentation depth for nested choices and branch bodies. */
  indent: number;
  kind:
    | "dialogue"
    | "choice-prompt"
    | "choice-option"
    | "branch"
    | "effect"
    | "stage"
    | "comment";
  /** Main text. Dialogue keeps original newlines for frontend pre-line rendering. */
  text: string;
  /** Dialogue speaker, currently derived from faceName. */
  speaker?: string;
  /** Leading line icon hint. */
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

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Normalize contract implementation into abstract pages. Top-level commands[] is treated as a single page. */
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
      // AIWF:* comments are machine anchors and should not appear in the review script.
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
      const scriptText = eventScriptText();
      lines.push({ indent, kind: "choice-prompt", text: scriptText.choicePrompt, icon: "❓" });
      const choices = Array.isArray(cmd.choices) ? (cmd.choices as unknown[]) : [];
      for (const choice of choices) {
        const optText = typeof choice === "string" ? choice : str((choice as Cmd)?.text);
        lines.push({ indent, kind: "choice-option", text: optText || scriptText.emptyChoice, icon: "▸" });
        if (choice && typeof choice === "object") {
          pushCommands(lines, (choice as Cmd).commands, indent + 1);
        }
      }
      return;
    }
    case "conditional-branch": {
      const scriptText = eventScriptText();
      lines.push({ indent, kind: "branch", text: eventScriptIfLabel(eventScriptBranchConditionLabel(cmd.condition as Cmd)), icon: "🔀" });
      pushCommands(lines, cmd.then ?? cmd.commands, indent + 1);
      if (Array.isArray(cmd.else) && cmd.else.length) {
        lines.push({ indent, kind: "branch", text: scriptText.elseBranch, icon: "🔀" });
        pushCommands(lines, cmd.else, indent + 1);
      }
      return;
    }
    case "loop": {
      lines.push({ indent, kind: "branch", text: eventScriptText().loop, icon: "🔁" });
      pushCommands(lines, cmd.commands, indent + 1);
      return;
    }
    case "break-loop":
      lines.push({ indent, kind: "stage", text: eventScriptText().breakLoop, icon: "⛒" });
      return;
    case "wait":
      lines.push({ indent, kind: "stage", text: eventScriptWaitLabel(num(cmd.frames) ?? 0), icon: "⏸" });
      return;
    case "show-balloon": {
      lines.push({ indent, kind: "stage", text: eventScriptBalloonLabel(num(cmd.balloonId)), icon: "💬" });
      return;
    }
    case "play-se":
      lines.push({ indent, kind: "stage", text: eventScriptSoundEffectLabel(str(cmd.name)), icon: "🔊" });
      return;
    case "move-route":
      lines.push({ indent, kind: "stage", text: eventScriptMoveLabel(cmd.target), icon: "🚶" });
      return;
    case "show-animation":
      lines.push({ indent, kind: "stage", text: eventScriptAnimationLabel(num(cmd.animationId)), icon: "✨" });
      return;
    case "screen-tint":
      lines.push({ indent, kind: "stage", text: eventScriptText().screenTint, icon: "🎨" });
      return;
    case "screen-flash":
      lines.push({ indent, kind: "stage", text: eventScriptText().screenFlash, icon: "⚡" });
      return;
    case "screen-shake":
      lines.push({ indent, kind: "stage", text: eventScriptText().screenShake, icon: "📳" });
      return;
    case "fadeout":
      lines.push({ indent, kind: "stage", text: eventScriptText().fadeout, icon: "🌑" });
      return;
    case "fadein":
      lines.push({ indent, kind: "stage", text: eventScriptText().fadein, icon: "🌕" });
      return;
    case "transfer":
      lines.push({
        indent,
        kind: "stage",
        text: eventScriptTransferLabel(num(cmd.mapId), num(cmd.x), num(cmd.y)),
        icon: "🚪",
      });
      return;
    case "common-event":
      lines.push({ indent, kind: "stage", text: eventScriptCommonEventLabel(num(cmd.id)), icon: "🔗" });
      return;
    case "plugin":
      lines.push({ indent, kind: "stage", text: eventScriptPluginCommandLabel(str(cmd.command)), icon: "🔌" });
      return;
    case "self-switch":
      lines.push({ indent, kind: "effect", text: eventScriptSelfSwitchLabel(str(cmd.name), cmd.value), icon: "⚙" });
      return;
    case "switch":
      lines.push({ indent, kind: "effect", text: eventScriptSwitchLabel(num(cmd.id), cmd.value), icon: "⚙" });
      return;
    case "variable":
      lines.push({ indent, kind: "effect", text: eventScriptVariableLabel(num(cmd.id), num(cmd.value) ?? 0), icon: "🔢" });
      return;
    case "change-gold": {
      const value = num(cmd.value) ?? 0;
      const sign = cmd.operation === "decrease" || value < 0 ? "−" : "+";
      lines.push({ indent, kind: "effect", text: eventScriptGoldLabel(sign, value), icon: "💰" });
      return;
    }
    case "change-items": {
      const value = num(cmd.value) ?? 0;
      const sign = cmd.operation === "decrease" || value < 0 ? "−" : "+";
      lines.push({ indent, kind: "effect", text: eventScriptItemLabel(num(cmd.itemId), sign, value), icon: "🎒" });
      return;
    }
    default:
      // Unknown kinds are shown explicitly so vocabulary gaps fail loudly.
      lines.push({ indent, kind: "stage", text: eventScriptUnknownCommandLabel(kind), icon: "⚠" });
      return;
  }
}

/** Render one event contract into a structured multi-page script. */
export function renderEventScript(contract: ContractLike | null | undefined): EventScriptModel {
  const safe: ContractLike = contract && typeof contract === "object" ? contract : {};
  const target = safe.rmmvTarget || {};
  const defaultTrigger = target.trigger;
  const rawPages = toPages(safe.implementation, defaultTrigger);
  const pages: EventScriptPage[] = rawPages.map((page, index) => {
    const { commands } = normalizeCommands(Array.isArray(page.commands) ? page.commands : []);
    const lines: EventScriptLine[] = [];
    pushCommands(lines, commands, 0);
    if (!lines.length) lines.push({ indent: 0, kind: "comment", text: eventScriptText().emptyPage, icon: "※" });
    const trigger = str(page.trigger) || str(defaultTrigger);
    const triggerLabels = eventScriptTriggerLabels();
    return {
      index,
      triggerLabel: triggerLabels[trigger] || trigger || triggerLabels["action-button"],
      conditionLabel: eventScriptPageConditionLabel(page.conditions),
      lines,
    };
  });
  return {
    contractId: str(safe.id),
    eventName: str(target.eventName) || str(safe.id) || undefined,
    pages,
  };
}
