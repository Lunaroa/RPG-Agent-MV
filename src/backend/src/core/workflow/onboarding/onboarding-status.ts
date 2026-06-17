// 项目初始化（onboarding）聚合状态：把 scan（地图/事件事实）、event-registry
// reconcile（未注册事件 + 漂移）与项目事实只读
// 检查汇总成一份低噪音报告，供 generalist 开工时判断要不要发 ASK 跟人商量。
//
// 本模块只读，不写工程、不写注册表、不建图。真正的收编/--apply/建图留给
// agent 在 ASK 批准后调既有命令执行。
//
// 设计上拆成两层：
//   - aggregateOnboardingStatus(input)：纯函数，给定 scan/reconcile 事实
//     算出报告，便于单测。
//   - gatherOnboardingStatus(project, options)：跑 IO（scan + reconcile +
//     语义层已移除，直接标记为跳过。

import { getStoryProjectProfile } from "../../desktop/story-page-sync-service.ts";
import { scanProject } from "../../rmmv/project-scanner.ts";
import { reconcile, loadRegistry } from "../event/event-registry.ts";

export type RagState = "missing" | "stale" | "fresh" | "unknown";
export type Severity = "clean" | "needs-attention" | "blocked";
export type ActionType =
  | "adopt-orphans"
  | "apply-safe-drift"
  | "build-rag"
  | "confirm-new-maps"
  | "declare-story-project"
  | "await-placement";

// 漂移里被当成"安全、可自动补"的两类（仅作计数提示；本命令不自动修，
// 留给 generalist 在 ASK 批准后跑 reconcile --apply）。
const SAFE_DRIFT_CODES = new Set(["status-stale-draft"]);

export interface OrphanEntry {
  mapId?: number;
  eventId?: number;
  eventName?: string;
  referencedId?: string;
}

export interface DriftBucketEntry {
  code: string;
  count: number;
}

export interface SuspectedMap {
  mapId: number;
  name: string;
  eventCount: number;
  reasons: string[];
}

export interface RecommendedAction {
  type: ActionType;
  label: string;
  scope: string;
  command: string;
  count?: number;
}

export interface OnboardingStatusReport {
  generatedAt: string;
  project: string;
  projectId?: string;
  registry: {
    reconcileStatus: string;
    orphanTagged: OrphanEntry[];
    orphanUntracked: OrphanEntry[];
    drifts: DriftBucketEntry[];
    safeDriftCount: number;
  };
  maps: {
    total: number;
    suspectedNew: SuspectedMap[];
    note: string;
  };
  rag: {
    state: RagState;
    detail?: string;
  };
  storyProject: {
    initialized: boolean;
    mode?: "original" | "mod";
    baselineVersion?: string;
  };
  awaitPlacement: {
    count: number;
  };
  severity: Severity;
  recommendedActions: RecommendedAction[];
}

// 纯函数输入：用最小结构解耦 scan/reconcile 的内部类型，方便单测构造 fixture。
export interface DriftLike {
  code: string;
  mapId?: number;
  eventId?: number;
  eventName?: string;
  referencedId?: string;
}

export interface OnboardingInput {
  project: string;
  projectId?: string;
  maps: { id: number; name: string; eventCount: number }[];
  drifts: DriftLike[];
  reconcileStatus: string;
  registryMapIds: number[];
  rag: { state: RagState; detail?: string };
  storyProject?: {
    initialized: boolean;
    mode?: "original" | "mod";
    baselineVersion?: string;
  };
  awaitPlacementCount?: number;
  generatedAt?: string;
}

const MAPS_HEURISTIC_NOTE =
  "地图层目前没有等价的注册/对账，以下为启发式推断（含未注册的 AIWF 孤儿事件，"
  + "或没有任何已注册契约指向该地图），不是权威结论，需人工确认哪些是真正的新增地图。";

function isInt(value: unknown): value is number {
  return Number.isInteger(value);
}

export function aggregateOnboardingStatus(input: OnboardingInput): OnboardingStatusReport {
  const orphanTagged: OrphanEntry[] = [];
  const orphanUntracked: OrphanEntry[] = [];
  const orphanMapIds = new Set<number>();
  const driftCounts = new Map<string, number>();
  let safeDriftCount = 0;

  for (const drift of input.drifts) {
    if (drift.code === "orphan-tagged") {
      orphanTagged.push(pickOrphan(drift));
      if (isInt(drift.mapId)) orphanMapIds.add(drift.mapId);
      continue;
    }
    if (drift.code === "orphan-untracked") {
      orphanUntracked.push(pickOrphan(drift));
      if (isInt(drift.mapId)) orphanMapIds.add(drift.mapId);
      continue;
    }
    driftCounts.set(drift.code, (driftCounts.get(drift.code) || 0) + 1);
    if (SAFE_DRIFT_CODES.has(drift.code)) safeDriftCount += 1;
  }

  const drifts: DriftBucketEntry[] = [...driftCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  // 疑似新增地图：有孤儿事件，或没有任何已注册契约指向（空注册表时会命中全部
  // 有事件的地图——这正是"做 mod 但注册表未建"该被提醒的信号）。
  const refSet = new Set(input.registryMapIds.filter(isInt));
  const suspectedNew: SuspectedMap[] = [];
  for (const map of input.maps) {
    if (map.eventCount <= 0) continue;
    const reasons: string[] = [];
    if (orphanMapIds.has(map.id)) reasons.push("含未注册（孤儿）事件");
    if (!refSet.has(map.id)) reasons.push("无任何已注册契约指向");
    if (reasons.length > 0) {
      suspectedNew.push({ mapId: map.id, name: map.name, eventCount: map.eventCount, reasons });
    }
  }

  const hasOrphans = orphanTagged.length + orphanUntracked.length > 0;
  const hasOtherDrift = drifts.length > 0;
  const ragNeedsBuild = false;
  const hasSuspectedMaps = suspectedNew.length > 0;
  const storyProject = input.storyProject || { initialized: false };
  const storyProjectUninitialized = !storyProject.initialized;
  const awaitPlacementCount = input.awaitPlacementCount ?? 0;

  let severity: Severity;
  if (input.rag.state === "unknown" || input.reconcileStatus === "no-data-dir") {
    // 没法完整体检（语义后端起不来 / 找不到 data 目录）：标 blocked，让 agent
    // 据实告诉用户"这部分没查成"，仍把已查到的问题一并报出。
    severity = "blocked";
  } else if (hasOrphans || hasOtherDrift || ragNeedsBuild || hasSuspectedMaps || storyProjectUninitialized) {
    severity = "needs-attention";
  } else {
    severity = "clean";
  }

  const recommendedActions: RecommendedAction[] = [];
  const orphanTotal = orphanTagged.length + orphanUntracked.length;
  if (orphanTotal > 0) {
    recommendedActions.push({
      type: "adopt-orphans",
      label: "收编未注册事件并同步注册表",
      scope: `${orphanTotal} 个未注册事件（${orphanTagged.length} 带标记 / ${orphanUntracked.length} 无标记）`,
      command: "event-registry adopt --project . --map <N> --event <N> --id <dotted.id>",
      count: orphanTotal,
    });
  }
  if (safeDriftCount > 0) {
    recommendedActions.push({
      type: "apply-safe-drift",
      label: "自动跟上陈旧状态",
      scope: `${safeDriftCount} 处安全漂移（draft→placed 状态）`,
      command: "event-registry reconcile --project . --apply",
      count: safeDriftCount,
    });
  }
  if (hasSuspectedMaps) {
    recommendedActions.push({
      type: "confirm-new-maps",
      label: "确认新增地图",
      scope: `${suspectedNew.length} 张疑似新增地图（启发式，需人工确认）`,
      command: "人在 console「地图制作 / 地图编辑」绑定真实项目地图",
      count: suspectedNew.length,
    });
  }
  if (storyProjectUninitialized) {
    recommendedActions.push({
      type: "declare-story-project",
      label: "启用受控事件编辑",
      scope: "工程尚未启用事件编辑；放置时会询问是否启用，暂不启用也可先放置到暂存",
      command: "在项目管理里启用事件编辑，并按需选择是否先创建 Git 保存点",
    });
  }
  if (awaitPlacementCount > 0) {
    recommendedActions.push({
      type: "await-placement",
      label: "在地图编辑器放置事件",
      scope: `${awaitPlacementCount} 个已注册 draft 契约尚无地图坐标`,
      command: "打开地图编辑页，选择目标地图并放置对应 EventContract 事件",
      count: awaitPlacementCount,
    });
  }

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    project: input.project,
    projectId: input.projectId,
    registry: {
      reconcileStatus: input.reconcileStatus,
      orphanTagged,
      orphanUntracked,
      drifts,
      safeDriftCount,
    },
    maps: {
      total: input.maps.length,
      suspectedNew,
      note: MAPS_HEURISTIC_NOTE,
    },
    rag: input.rag,
    storyProject,
    awaitPlacement: { count: awaitPlacementCount },
    severity,
    recommendedActions,
  };
}

function pickOrphan(drift: DriftLike): OrphanEntry {
  return {
    mapId: drift.mapId,
    eventId: drift.eventId,
    eventName: drift.eventName,
    referencedId: drift.referencedId,
  };
}

// 解析 kb semantic-status 的单行 JSON 输出（{status, stale, ...}）。docker/python
// 可能在 JSON 前混入告警，故取最后一个能解析成 JSON 的行。
export function parseRagState(stdout: string | null): { state: RagState; detail?: string } {
  if (!stdout || !stdout.trim()) {
    return { state: "unknown", detail: "GraphRAG 已移除" };
  }
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const json = JSON.parse(lines[i]) as { status?: unknown; stale?: unknown; staleReason?: unknown };
      const status = String(json.status ?? "");
      const stale = Boolean(json.stale);
      const detail = typeof json.staleReason === "string" && json.staleReason ? json.staleReason : status;
      if (status === "missing") return { state: "missing", detail };
      if (stale || status === "stale") return { state: "stale", detail };
      return { state: "fresh", detail: status || undefined };
    } catch {
      // 继续往前找可解析的行
    }
  }
  return { state: "unknown", detail: "GraphRAG 已移除" };
}

function probeRag(_projectId?: string): { state: RagState; detail?: string } {
  return { state: 'fresh', detail: 'GraphRAG 已移除，跳过检查' };
}

export interface GatherOptions {
  projectId?: string;
  runtimeRoot?: string;
}

export async function gatherOnboardingStatus(
  project: string,
  options: GatherOptions = {},
): Promise<OnboardingStatusReport> {
  const scan = scanProject(project);
  const recon = await reconcile(project, { orphans: true, runtimeRoot: options.runtimeRoot });
  const registry = loadRegistry(project, { runtimeRoot: options.runtimeRoot });
  const registryMapIds = registry.contracts
    .map((contract) => contract.rmmvTarget?.mapId)
    .filter((mapId): mapId is number => Number.isInteger(mapId));
  const rag = probeRag(options.projectId);
  const profile = getStoryProjectProfile(project);
  const storyProject = profile
    ? { initialized: true, mode: profile.mode, baselineVersion: profile.baselineVersion }
    : { initialized: false };
  const awaitPlacementCount = registry.contracts.filter((contract) => {
    const status = contract.status || "draft";
    if (status !== "draft") return false;
    const placement = contract.placement;
    return !placement || !Number.isInteger(placement.eventId);
  }).length;

  return aggregateOnboardingStatus({
    project,
    projectId: options.projectId,
    maps: scan.maps.map((map) => ({ id: map.id, name: map.name, eventCount: map.eventCount })),
    drifts: recon.drifts.map((drift) => ({
      code: drift.code,
      mapId: drift.mapId,
      eventId: drift.eventId,
      eventName: drift.eventName,
      referencedId: drift.referencedId,
    })),
    reconcileStatus: recon.status,
    registryMapIds,
    rag,
    storyProject,
    awaitPlacementCount,
  });
}

const SEVERITY_LABEL: Record<Severity, string> = {
  clean: "clean（已登记齐整）",
  "needs-attention": "needs-attention（有未登记内容或 RAG 未建，建议先和用户商量）",
  blocked: "blocked（部分检查未完成，见下）",
};

export function renderOnboardingSummary(report: OnboardingStatusReport): string {
  const lines: string[] = [];
  lines.push(`Onboarding severity: ${SEVERITY_LABEL[report.severity]}`);
  lines.push(
    `未注册事件: ${report.registry.orphanTagged.length} 带标记 / ${report.registry.orphanUntracked.length} 无标记`,
  );
  const driftSummary = report.registry.drifts.length
    ? report.registry.drifts.map((d) => `${d.code}×${d.count}`).join(", ")
    : "无";
  lines.push(`注册表漂移: ${driftSummary}（安全可补 ${report.registry.safeDriftCount} 处；reconcile=${report.registry.reconcileStatus}）`);
  lines.push(`疑似新增地图: ${report.maps.suspectedNew.length}/${report.maps.total}（启发式，需人工确认）`);
  lines.push(`语义层: ${report.rag.state}${report.rag.detail ? `（${report.rag.detail}）` : ""}`);
  lines.push(
    `剧情项目: ${report.storyProject.initialized
      ? "已启用"
      : "未启用（需先启用事件编辑）"}`,
  );
  if (report.awaitPlacement.count > 0) {
    lines.push(`待放置契约: ${report.awaitPlacement.count} 个 draft 尚无坐标`);
  }
  if (report.recommendedActions.length) {
    lines.push("建议动作（供转 ASK 选项；任何写入前先发 plan-approval）:");
    for (const action of report.recommendedActions) {
      lines.push(`  - [${action.type}] ${action.label} —— ${action.scope}`);
    }
  } else {
    lines.push("建议动作: 无");
  }
  return lines.join("\n");
}

export function renderOnboardingMarkdown(report: OnboardingStatusReport): string {
  const lines: string[] = [];
  lines.push("# 项目初始化（onboarding）状态");
  lines.push("");
  lines.push(`- 生成时间: ${report.generatedAt}`);
  lines.push(`- 工程: ${report.project}`);
  if (report.projectId) lines.push(`- projectId: ${report.projectId}`);
  lines.push(`- severity: **${report.severity}**`);
  lines.push("");

  lines.push("## 未注册事件");
  lines.push("");
  lines.push(`- 带标记孤儿（高信号）: ${report.registry.orphanTagged.length}`);
  for (const orphan of report.registry.orphanTagged) {
    lines.push(`  - Map${pad(orphan.mapId)} 事件#${orphan.eventId ?? "?"} ${orphan.eventName || ""}${orphan.referencedId ? `（标记 ${orphan.referencedId}）` : ""}`);
  }
  lines.push(`- 无标记孤儿（手工/遗留）: ${report.registry.orphanUntracked.length}`);
  for (const orphan of report.registry.orphanUntracked) {
    lines.push(`  - Map${pad(orphan.mapId)} 事件#${orphan.eventId ?? "?"} ${orphan.eventName || ""}`);
  }
  lines.push("");

  lines.push("## 注册表漂移");
  lines.push("");
  lines.push(`- reconcile 状态: ${report.registry.reconcileStatus}`);
  lines.push(`- 安全可自动补: ${report.registry.safeDriftCount} 处（reconcile --apply）`);
  if (report.registry.drifts.length) {
    for (const drift of report.registry.drifts) {
      lines.push(`- ${drift.code}: ${drift.count}`);
    }
  } else {
    lines.push("- 无其他漂移");
  }
  lines.push("");

  lines.push("## 疑似新增地图");
  lines.push("");
  lines.push(`> ${report.maps.note}`);
  lines.push("");
  lines.push(`- 命中 ${report.maps.suspectedNew.length} / 共 ${report.maps.total} 张地图`);
  for (const map of report.maps.suspectedNew) {
    lines.push(`  - Map${pad(map.mapId)} ${map.name}（${map.eventCount} 个事件）— ${map.reasons.join("，")}`);
  }
  lines.push("");

  lines.push("## 项目上下文");
  lines.push("");
  lines.push(`- 状态: ${report.rag.state}`);
  if (report.rag.detail) lines.push(`- 说明: ${report.rag.detail}`);
  lines.push("");

  lines.push("## 剧情项目");
  lines.push("");
  if (report.storyProject.initialized) {
    lines.push("- 已启用: **事件编辑**");
  } else {
    lines.push("- **未启用** — 放置时会询问是否启用；暂不启用也可先放置到暂存，直接改已有事件需先启用");
  }
  lines.push(`- 待放置 draft 契约: ${report.awaitPlacement.count}`);
  lines.push("");

  lines.push("## 建议动作");
  lines.push("");
  lines.push("> 一律先 ASK 再动：用户选定后，任何写操作执行前必须先发 plan-approval。");
  lines.push("");
  if (report.recommendedActions.length) {
    for (const action of report.recommendedActions) {
      lines.push(`- **${action.label}** (\`${action.type}\`)`);
      lines.push(`  - 影响范围: ${action.scope}`);
      lines.push(`  - 对应命令: \`${action.command}\``);
    }
  } else {
    lines.push("- 无（工程已登记齐整）");
  }
  lines.push("");
  return lines.join("\n");
}

function pad(mapId?: number): string {
  return Number.isInteger(mapId) ? String(mapId).padStart(3, "0") : "???";
}



