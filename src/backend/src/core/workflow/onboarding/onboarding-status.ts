// Project onboarding aggregate status: merge scan facts, event-registry
// reconcile output, and project facts into a low-noise report for the
// generalist agent before it decides whether to ask the user.
//
// This module is read-only. It does not write the project, registry, or maps.
// Real adoption, --apply, and map work remain explicit agent actions after ASK
// approval.
//
// The design has two layers:
//   - aggregateOnboardingStatus(input): pure function over scan/reconcile facts.
//   - gatherOnboardingStatus(project, options): IO wrapper for scan/reconcile.
//     The semantic layer has been removed and is reported as skipped.

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

// Drift codes considered safe to auto-apply after user approval. This command
// only counts them; the generalist must run reconcile --apply after ASK approval.
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

// Pure-function input kept minimal to decouple tests from scan/reconcile internals.
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
  "The map layer does not have an equivalent registry/reconcile source yet. "
  + "These results are heuristic: maps can be flagged because they contain unregistered AIWF orphan events "
  + "or because no registered contract points to them. This is not authoritative; a human must confirm which maps are truly new.";

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

  // Suspected new maps: maps with orphan events, or maps that no registered
  // contract points to. An empty registry intentionally flags every map that
  // contains events because mod projects without registry setup need attention.
  const refSet = new Set(input.registryMapIds.filter(isInt));
  const suspectedNew: SuspectedMap[] = [];
  for (const map of input.maps) {
    if (map.eventCount <= 0) continue;
    const reasons: string[] = [];
    if (orphanMapIds.has(map.id)) reasons.push("contains unregistered orphan events");
    if (!refSet.has(map.id)) reasons.push("no registered contract points to this map");
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
    // The audit could not complete, so mark the report blocked while still
    // returning all facts that were collected.
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
      label: "Adopt unregistered events and sync the registry",
      scope: `${orphanTotal} unregistered events (${orphanTagged.length} tagged / ${orphanUntracked.length} untracked)`,
      command: "event-registry adopt --project . --map <N> --event <N> --id <dotted.id>",
      count: orphanTotal,
    });
  }
  if (safeDriftCount > 0) {
    recommendedActions.push({
      type: "apply-safe-drift",
      label: "Apply safe stale-state drift",
      scope: `${safeDriftCount} safe drift item(s) (draft to placed status)`,
      command: "event-registry reconcile --project . --apply",
      count: safeDriftCount,
    });
  }
  if (hasSuspectedMaps) {
    recommendedActions.push({
      type: "confirm-new-maps",
      label: "Confirm new maps",
      scope: `${suspectedNew.length} suspected new map(s) (heuristic; human confirmation required)`,
      command: "Bind the real project map in Console > Map Production / Map Editor",
      count: suspectedNew.length,
    });
  }
  if (storyProjectUninitialized) {
    recommendedActions.push({
      type: "declare-story-project",
      label: "Enable controlled event editing",
      scope: "Event editing is not enabled yet. Placement can ask to enable it; keeping it disabled still allows staging first.",
      command: "Enable event editing in project management and choose whether to create a Git save point first",
    });
  }
  if (awaitPlacementCount > 0) {
    recommendedActions.push({
      type: "await-placement",
      label: "Place events in the map editor",
      scope: `${awaitPlacementCount} registered draft contract(s) have no map coordinates`,
      command: "Open the map editor, choose the target map, and place the corresponding EventContract event",
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

// Parse single-line JSON output from the removed semantic status probe. Older
// docker/python invocations could add warnings before JSON, so keep the last
// parseable JSON line behavior.
export function parseRagState(stdout: string | null): { state: RagState; detail?: string } {
  if (!stdout || !stdout.trim()) {
    return { state: "unknown", detail: "GraphRAG has been removed" };
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
      // Keep scanning backward for a parseable line.
    }
  }
  return { state: "unknown", detail: "GraphRAG has been removed" };
}

function probeRag(_projectId?: string): { state: RagState; detail?: string } {
  return { state: 'fresh', detail: 'GraphRAG has been removed; check skipped' };
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
  clean: "clean (registry is aligned)",
  "needs-attention": "needs-attention (unregistered content or setup gaps; ask the user first)",
  blocked: "blocked (some checks did not complete; see details below)",
};

export function renderOnboardingSummary(report: OnboardingStatusReport): string {
  const lines: string[] = [];
  lines.push(`Onboarding severity: ${SEVERITY_LABEL[report.severity]}`);
  lines.push(
    `Unregistered events: ${report.registry.orphanTagged.length} tagged / ${report.registry.orphanUntracked.length} untracked`,
  );
  const driftSummary = report.registry.drifts.length
    ? report.registry.drifts.map((d) => `${d.code}×${d.count}`).join(", ")
    : "none";
  lines.push(`Registry drift: ${driftSummary} (${report.registry.safeDriftCount} safe to apply; reconcile=${report.registry.reconcileStatus})`);
  lines.push(`Suspected new maps: ${report.maps.suspectedNew.length}/${report.maps.total} (heuristic; human confirmation required)`);
  lines.push(`Semantic layer: ${report.rag.state}${report.rag.detail ? ` (${report.rag.detail})` : ""}`);
  lines.push(
    `Story project: ${report.storyProject.initialized
      ? "enabled"
      : "not enabled (event editing must be enabled first)"}`,
  );
  if (report.awaitPlacement.count > 0) {
    lines.push(`Awaiting placement: ${report.awaitPlacement.count} draft contract(s) have no coordinates`);
  }
  if (report.recommendedActions.length) {
    lines.push("Recommended actions (convert to ASK options; send plan-approval before any write):");
    for (const action of report.recommendedActions) {
      lines.push(`  - [${action.type}] ${action.label} —— ${action.scope}`);
    }
  } else {
    lines.push("Recommended actions: none");
  }
  return lines.join("\n");
}

export function renderOnboardingMarkdown(report: OnboardingStatusReport): string {
  const lines: string[] = [];
  lines.push("# Project Onboarding Status");
  lines.push("");
  lines.push(`- Generated At: ${report.generatedAt}`);
  lines.push(`- Project: ${report.project}`);
  if (report.projectId) lines.push(`- projectId: ${report.projectId}`);
  lines.push(`- severity: **${report.severity}**`);
  lines.push("");

  lines.push("## Unregistered Events");
  lines.push("");
  lines.push(`- Tagged orphans (high signal): ${report.registry.orphanTagged.length}`);
  for (const orphan of report.registry.orphanTagged) {
    lines.push(`  - Map${pad(orphan.mapId)} event #${orphan.eventId ?? "?"} ${orphan.eventName || ""}${orphan.referencedId ? ` (tag ${orphan.referencedId})` : ""}`);
  }
  lines.push(`- Untracked orphans (manual/legacy): ${report.registry.orphanUntracked.length}`);
  for (const orphan of report.registry.orphanUntracked) {
    lines.push(`  - Map${pad(orphan.mapId)} event #${orphan.eventId ?? "?"} ${orphan.eventName || ""}`);
  }
  lines.push("");

  lines.push("## Registry Drift");
  lines.push("");
  lines.push(`- Reconcile Status: ${report.registry.reconcileStatus}`);
  lines.push(`- Safe to auto-apply: ${report.registry.safeDriftCount} item(s) (reconcile --apply)`);
  if (report.registry.drifts.length) {
    for (const drift of report.registry.drifts) {
      lines.push(`- ${drift.code}: ${drift.count}`);
    }
  } else {
    lines.push("- No other drift");
  }
  lines.push("");

  lines.push("## Suspected New Maps");
  lines.push("");
  lines.push(`> ${report.maps.note}`);
  lines.push("");
  lines.push(`- Matched ${report.maps.suspectedNew.length} / ${report.maps.total} maps`);
  for (const map of report.maps.suspectedNew) {
    lines.push(`  - Map${pad(map.mapId)} ${map.name} (${map.eventCount} events) - ${map.reasons.join(", ")}`);
  }
  lines.push("");

  lines.push("## Project Context");
  lines.push("");
  lines.push(`- State: ${report.rag.state}`);
  if (report.rag.detail) lines.push(`- Detail: ${report.rag.detail}`);
  lines.push("");

  lines.push("## Story Project");
  lines.push("");
  if (report.storyProject.initialized) {
    lines.push("- Enabled: **event editing**");
  } else {
    lines.push("- **Not enabled** - placement can ask to enable it; keeping it disabled still allows staging first, but direct existing-event edits require it.");
  }
  lines.push(`- Draft contracts awaiting placement: ${report.awaitPlacement.count}`);
  lines.push("");

  lines.push("## Recommended Actions");
  lines.push("");
  lines.push("> Always ASK first. After the user chooses, send plan-approval before any write action.");
  lines.push("");
  if (report.recommendedActions.length) {
    for (const action of report.recommendedActions) {
      lines.push(`- **${action.label}** (\`${action.type}\`)`);
      lines.push(`  - Scope: ${action.scope}`);
      lines.push(`  - Command: \`${action.command}\``);
    }
  } else {
    lines.push("- None (the project registry is aligned)");
  }
  lines.push("");
  return lines.join("\n");
}

function pad(mapId?: number): string {
  return Number.isInteger(mapId) ? String(mapId).padStart(3, "0") : "???";
}



