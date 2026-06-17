import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../rmmv/json.ts";

interface SlotSummary {
  candidateCount: number;
  totalSlots: number;
  named: number;
  empty: number;
  usedUnnamed?: number;
  usedEmpty?: number;
  unnamedOccupied?: number;
}

interface SlotUsage {
  conditions?: number;
  writes?: number;
  calls?: number;
}

interface SlotCandidate {
  id: number;
  reason: string;
  usage?: SlotUsage;
  staleSwitchId?: number;
}

interface StateSlotsSummary {
  switches: SlotSummary;
  variables: SlotSummary;
  commonEvents: SlotSummary;
}

interface StateSlotsCandidates {
  switches: SlotCandidate[];
  variables: SlotCandidate[];
  commonEvents: SlotCandidate[];
}

interface StateSlotsReport {
  generatedAt: string;
  projectRoot: string;
  dataDir: string;
  summary: StateSlotsSummary;
  candidates: StateSlotsCandidates;
  blockedEmptySlots: StateSlotsCandidates;
  reviewNotes: string[];
}

function writeStateSlotsOutputs(report: StateSlotsReport, outDir: string): { rendered: string } {
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, "state-slots.json"), report);
  const rendered = renderStateSlotsReport(report);
  fs.writeFileSync(path.join(outDir, "state-slots.md"), rendered, "utf8");
  return { rendered };
}

function renderStateSlotsReport(report: StateSlotsReport): string {
  const lines = [];
  lines.push("# RPG Maker MV State Slot Candidates");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Project: ${report.projectRoot}`);
  lines.push(`Data: ${report.dataDir}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  appendSummary(lines, "Switches", report.summary.switches);
  appendSummary(lines, "Variables", report.summary.variables);
  appendSummary(lines, "Common events", report.summary.commonEvents);
  lines.push("");
  lines.push("## Candidate Slots");
  lines.push("");
  appendCandidates(lines, "Switches", report.candidates.switches, "switch");
  appendCandidates(lines, "Variables", report.candidates.variables, "variable");
  appendCandidates(lines, "Common Events", report.candidates.commonEvents, "common-event");
  lines.push("");
  lines.push("## Blocked Empty Slots");
  lines.push("");
  appendCandidates(lines, "Switches", report.blockedEmptySlots.switches, "switch");
  appendCandidates(lines, "Variables", report.blockedEmptySlots.variables, "variable");
  appendCandidates(lines, "Common Events", report.blockedEmptySlots.commonEvents, "common-event");
  lines.push("");
  lines.push("## Review Notes");
  lines.push("");
  for (const note of report.reviewNotes) lines.push(`- ${note}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function appendSummary(lines: string[], label: string, summary: SlotSummary): void {
  lines.push(`- ${label}: ${summary.candidateCount} candidate(s) from ${summary.totalSlots} configured slot(s); named=${summary.named}, empty=${summary.empty}.`);
  if (summary.usedUnnamed) lines.push(`  Empty named slots with indexed usage: ${summary.usedUnnamed}.`);
  if (summary.usedEmpty) lines.push(`  Empty common event slots with indexed calls: ${summary.usedEmpty}.`);
  if (summary.unnamedOccupied) lines.push(`  Unnamed but non-empty common event slots: ${summary.unnamedOccupied}.`);
}

function appendCandidates(lines: string[], label: string, candidates: SlotCandidate[], kind: string): void {
  lines.push(`### ${label}`);
  lines.push("");
  if (!candidates.length) {
    lines.push("- None shown.");
    lines.push("");
    return;
  }
  for (const candidate of candidates) {
    const stale = candidate.staleSwitchId ? ` staleSwitchId=${candidate.staleSwitchId}` : "";
    lines.push(`- ${kind} ${candidate.id}: ${candidate.reason}; usage=${usageText(candidate.usage)}${stale}`);
  }
  lines.push("");
}

function usageText(usage: SlotUsage | undefined): string {
  if (!usage) return "none";
  const parts = [];
  if (usage.conditions) parts.push(`conditions=${usage.conditions}`);
  if (usage.writes) parts.push(`writes=${usage.writes}`);
  if (usage.calls) parts.push(`calls=${usage.calls}`);
  return parts.length ? parts.join(",") : "none";
}

export { writeStateSlotsOutputs };
