import path from "path";

/** Runtime stderr / plain-line messages when external_directory is denied. */
export const RUNTIME_PERMISSION_DENIAL_RE =
  /permission requested:\s*external_directory|auto-rejecting/i;

/** Short hint injected once per run for the model (not a user-facing blocker). */
export const PERMISSION_DENIAL_MODEL_HINT =
  "目录权限：请勿 Read/List 用户主目录、全局配置或产品根之外的未授权路径；工具说明从 `AGENT_RPG_ROOT/AGENT_GUIDE.md` 开始读。";

export function containsRuntimePermissionDenial(text: string): boolean {
  return RUNTIME_PERMISSION_DENIAL_RE.test(text || "");
}

/** Native opencode resume failures (invalid/expired session id). */
export const NATIVE_SESSION_RESUME_FAILURE_RE =
  /(?:--resume|resume\s+(?:session|failed)|session\s+(?:not\s+found|expired|invalid)|unknown\s+session|invalid\s+session\s+id|could\s+not\s+resume)/i;

export function containsNativeSessionResumeFailure(text: string): boolean {
  return NATIVE_SESSION_RESUME_FAILURE_RE.test(text || "");
}

/** Glob allow-list for external_directory when agent cwd is the MV game project. */
export function buildExternalDirectoryAllowList(workflowRoot: string): Record<string, "allow"> {
  const fwd = (p: string) => path.resolve(p).replace(/\\/g, "/");
  const wf = fwd(workflowRoot);
  return {
    [`${wf}/**`]: "allow",
  };
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

export function assessAgentRuntimeOutcome(options: {
  exitCode: number | null;
  stopped: boolean;
  timedOut: boolean;
  renderedStdout: string;
  stderr: string;
  rawStdout?: string;
}): RuntimeOutcomeAssessment {
  const log = `${options.renderedStdout || ""}\n${options.stderr || ""}\n${options.rawStdout || ""}`;
  const hadPermissionDenial = containsRuntimePermissionDenial(log);
  const hadAssistantText = hasMeaningfulAssistantText(options.renderedStdout || "");
  const exitOk = options.exitCode === 0 && !options.timedOut && !options.stopped;

  if (!hadPermissionDenial) {
    return {
      hadPermissionDenial: false,
      hadAssistantText,
      status: exitOk ? "pass" : "blocked",
      blocker: exitOk ? null : null,
      userMessage: null,
    };
  }

  const userMessage = buildPermissionFailureUserMessage();
  if (!exitOk) {
    return {
      hadPermissionDenial: true,
      hadAssistantText,
      status: "blocked",
      blocker: options.stopped
        ? "Agent backend was stopped by the console user."
        : `运行时拒绝了访问工作区外的目录。${userMessage}`,
      userMessage,
    };
  }

  if (!hadAssistantText) {
    return {
      hadPermissionDenial: true,
      hadAssistantText: false,
      status: "blocked",
      blocker: `运行时因目录权限被拒提前结束，未生成回复。${userMessage}`,
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

export function buildPermissionFailureUserMessage(): string {
  return [
    "部分文件工具因 **external_directory** 权限被拒（常见于在游戏工程 cwd 下尝试 Read 用户主目录、全局 Agent 配置目录或仓库外的路径）。",
    "Agent 应只读：**游戏工程**与 **`RPG-Agent-MV/`**。工具说明从 `RPG-Agent-MV/AGENT_GUIDE.md` 开始，不要读用户主目录、全局配置或产品根之外的未授权路径。",
    "请**结束当前会话并新建一轮**；若仍失败，确认 opencode 的目录权限包含 RPG-Agent-MV 产品根与当前游戏工程。",
    "剧情事件可在 **地图编辑页** 手动放置；若 agent 已注册 EventContract，应通过当前地图编辑流程继续。",
  ].join("\n");
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
}): RuntimeOutcomeAssessment | null {
  if (!dispatch?.backendOutput) return null;
  const timedOut = Boolean(dispatch.execution?.timedOut);
  const exitCode = dispatch.execution?.exitCode ?? null;
  const explicitSuccessfulTurn = dispatch.status === "pass" && !dispatch.blocker && !timedOut;
  return assessAgentRuntimeOutcome({
    exitCode: exitCode === null && explicitSuccessfulTurn ? 0 : exitCode,
    stopped: dispatch.blocker?.includes("stopped by the console") ?? false,
    timedOut,
    renderedStdout: dispatch.backendOutput.stdout || "",
    stderr: dispatch.backendOutput.stderr || "",
    rawStdout: dispatch.backendOutput.rawStdout,
  });
}
