import type { ProductLanguage } from "../../../../../contract/types.ts";
import { normalizeProductLanguage } from "../../../../../contract/i18n.ts";
import { backendText } from "../../i18n/messages.ts";

/** Runtime stderr / plain-line messages when external_directory is denied. */
export const RUNTIME_PERMISSION_DENIAL_RE =
  /permission requested:\s*external_directory|auto-rejecting/i;

export function containsRuntimePermissionDenial(text: string): boolean {
  return RUNTIME_PERMISSION_DENIAL_RE.test(text || "");
}

/** Native opencode resume failures (invalid/expired session id). */
export const NATIVE_SESSION_RESUME_FAILURE_RE =
  /(?:--resume|resume\s+(?:session|failed)|session\s+(?:not\s+found|expired|invalid)|unknown\s+session|invalid\s+session\s+id|could\s+not\s+resume)/i;

export function containsNativeSessionResumeFailure(text: string): boolean {
  return NATIVE_SESSION_RESUME_FAILURE_RE.test(text || "");
}

export function isPermissionSkippedToolResult(output: string, success?: boolean): boolean {
  if (containsRuntimePermissionDenial(output || "")) return true;
  if (success === false && /external_directory|outside.*director|auto-reject/i.test(output || "")) {
    return true;
  }
  return false;
}

export interface RuntimeOutcomeAssessment {
  hadPermissionDenial: boolean;
  hadAssistantText: boolean;
  status: "pass" | "blocked";
  blocker: string | null;
  userMessage: string | null;
}

/** 运行时识别「被控制台停止」的 blocker 文案：中英文都覆盖（避免靠单一语言文案误判）。 */
const STOPPED_BY_CONSOLE_RE = /stopped by the console|已被控制台用户停止/i;

export function isStoppedByConsole(blocker: string | null | undefined): boolean {
  return STOPPED_BY_CONSOLE_RE.test(blocker || "");
}

export function assessAgentRuntimeOutcome(options: {
  exitCode: number | null;
  stopped: boolean;
  timedOut: boolean;
  renderedStdout: string;
  stderr: string;
  rawStdout?: string;
  productLanguage?: ProductLanguage | null;
}): RuntimeOutcomeAssessment {
  const log = `${options.renderedStdout || ""}\n${options.stderr || ""}\n${options.rawStdout || ""}`;
  const hadPermissionDenial = containsRuntimePermissionDenial(log);
  const hadAssistantText = hasMeaningfulAssistantText(options.renderedStdout || "");
  const exitOk = options.exitCode === 0 && !options.timedOut && !options.stopped;
  const language = normalizeProductLanguage(options.productLanguage);

  if (!hadPermissionDenial) {
    return {
      hadPermissionDenial: false,
      hadAssistantText,
      status: exitOk ? "pass" : "blocked",
      blocker: exitOk
        ? null
        : options.stopped
          ? backendText('runtime.stoppedByConsole', language)
          : options.timedOut
            ? backendText('runtime.agentTimeout', language)
            : backendText('runtime.agentExited', language, { code: String(options.exitCode ?? -1) }),
      userMessage: null,
    };
  }

  const userMessage = buildPermissionFailureUserMessage(language);
  if (!exitOk) {
    return {
      hadPermissionDenial: true,
      hadAssistantText,
      status: "blocked",
      blocker: options.stopped
        ? backendText('runtime.stoppedByConsole', language)
        : backendText(
            'runtime.permissionDenialBlocked',
            language,
            { userMessage: userMessage || '' },
          ),
      userMessage,
    };
  }

  if (!hadAssistantText) {
    return {
      hadPermissionDenial: true,
      hadAssistantText: false,
      status: "blocked",
      blocker: backendText(
        'runtime.permissionDenialNoReply',
        language,
        { userMessage: userMessage || '' },
      ),
      userMessage,
    };
  }

  return {
    hadPermissionDenial: true,
    hadAssistantText: true,
    status: "pass",
    blocker: null,
    userMessage,
  };
}

export function buildPermissionFailureUserMessage(language?: ProductLanguage | null): string {
  return backendText('runtime.permissionFailureUserMessage', language);
}

function hasMeaningfulAssistantText(renderedStdout: string): boolean {
  const stripped = renderedStdout
    .replace(/\[tool\][^\n]*/g, "")
    .replace(/permission requested:[^\n]*/gi, "")
    .replace(/auto-rejecting[^\n]*/gi, "")
    .trim();
  return stripped.length >= 24;
}

export function assessDispatchBackendOutput(dispatch: {
  status?: string;
  blocker?: string | null;
  execution?: { exitCode?: number | null; timedOut?: boolean };
  backendOutput?: { stdout?: string; stderr?: string; rawStdout?: string };
  productLanguage?: ProductLanguage | null;
}): RuntimeOutcomeAssessment | null {
  if (!dispatch?.backendOutput) return null;
  const timedOut = Boolean(dispatch.execution?.timedOut);
  const exitCode = dispatch.execution?.exitCode ?? null;
  const explicitSuccessfulTurn = dispatch.status === "pass" && !dispatch.blocker && !timedOut;
  return assessAgentRuntimeOutcome({
    exitCode: exitCode === null && explicitSuccessfulTurn ? 0 : exitCode,
    stopped: isStoppedByConsole(dispatch.blocker),
    timedOut,
    renderedStdout: dispatch.backendOutput.stdout || "",
    stderr: dispatch.backendOutput.stderr || "",
    rawStdout: dispatch.backendOutput.rawStdout,
    productLanguage: dispatch.productLanguage,
  });
}
