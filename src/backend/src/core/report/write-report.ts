import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../rmmv/json.ts";

interface ScanIndexMap {
  id: number;
  name?: string;
  width: number;
  height: number;
  eventCount: number;
  tilesetId: number;
}

interface ScanFinding {
  severity: string;
  code: string;
  message: string;
}

interface ScanAuditSummary {
  total: number;
  error: number;
  warning: number;
  manualReview: number;
}

interface ScanAudit {
  summary: ScanAuditSummary;
  findings: ScanFinding[];
}

interface ScanIndex {
  generatedAt: string;
  projectRoot: string;
  dataDir: string;
  maps: ScanIndexMap[];
  switches: unknown[];
  variables: unknown[];
  commonEvents: unknown[];
  audit: ScanAudit;
}

function writeScanOutputs(index: ScanIndex, outDir: string): { agentContext: string } {
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, "project-index.json"), index);
  fs.writeFileSync(path.join(outDir, "audit-report.md"), renderAuditReport(index), "utf8");
  const agentContext = renderAgentContext(index);
  fs.writeFileSync(path.join(outDir, "agent-context.md"), agentContext, "utf8");
  return { agentContext };
}

function renderAuditReport(index: ScanIndex): string {
  const lines = [];
  lines.push("# RPG Maker MV Audit Report");
  lines.push("");
  lines.push(`Generated: ${index.generatedAt}`);
  lines.push(`Project: ${index.projectRoot}`);
  lines.push(`Data: ${index.dataDir}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Maps: ${index.maps.length}`);
  lines.push(`- Map events: ${sum(index.maps.map((map) => map.eventCount || 0))}`);
  lines.push(`- Named switches: ${index.switches.length}`);
  lines.push(`- Named variables: ${index.variables.length}`);
  lines.push(`- Common events: ${index.commonEvents.length}`);
  lines.push(`- Findings: ${index.audit.summary.total}`);
  lines.push(`- Errors: ${index.audit.summary.error}`);
  lines.push(`- Warnings: ${index.audit.summary.warning}`);
  lines.push(`- Manual review: ${index.audit.summary.manualReview}`);
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (index.audit.findings.length === 0) {
    lines.push("No findings.");
  } else {
    for (const item of index.audit.findings.slice(0, 300)) {
      lines.push(`- [${item.severity}] ${item.code}: ${item.message}`);
    }
    if (index.audit.findings.length > 300) {
      lines.push(`- ... ${index.audit.findings.length - 300} more findings omitted from this report. See project-index.json.`);
    }
  }
  lines.push("");
  lines.push("## Human Review Checklist");
  lines.push("");
  lines.push("- Review all `error` findings before any agent-authored patch is accepted.");
  lines.push("- Review script calls and plugin commands because their semantics are project-specific.");
  lines.push("- Inspect autorun pages for exit conditions to avoid soft locks.");
  lines.push("- Inspect parallel pages for repeated writes or performance-sensitive loops.");
  lines.push("- Confirm newly planned switches and variables do not collide with existing named entries.");
  lines.push("- Re-run this scan after every generated change and compare reports.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderAgentContext(index: ScanIndex): string {
  const lines = [];
  lines.push("# Agent Context");
  lines.push("");
  lines.push("Use this as low-noise context for planning. Do not treat it as permission to edit raw RPG Maker MV JSON.");
  lines.push("");
  lines.push("## Project Shape");
  lines.push("");
  lines.push(`- Maps: ${index.maps.length}`);
  lines.push(`- Common events: ${index.commonEvents.length}`);
  lines.push(`- Named switches: ${index.switches.length}`);
  lines.push(`- Named variables: ${index.variables.length}`);
  lines.push("");
  lines.push("## Maps");
  lines.push("");
  for (const map of index.maps.slice(0, 200)) {
    lines.push(`- ${map.id}:${map.name || "(unnamed)"} size=${map.width}x${map.height} events=${map.eventCount} tileset=${map.tilesetId}`);
  }
  if (index.maps.length > 200) lines.push(`- ... ${index.maps.length - 200} more maps`);
  lines.push("");
  lines.push("## High-Risk Review Areas");
  lines.push("");
  const risky = index.audit.findings
    .filter((item) => item.severity === "error" || item.severity === "warning" || item.severity === "manual-review")
    .slice(0, 80);
  if (risky.length === 0) {
    lines.push("- No high-risk findings in the current scan.");
  } else {
    for (const item of risky) lines.push(`- [${item.severity}] ${item.message}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export { writeScanOutputs };
