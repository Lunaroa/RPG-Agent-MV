import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../rmmv/json.ts";

interface RuntimeTestFinding {
  severity: string;
  code: string;
  message: string;
}

interface StaticReview {
  status?: string;
  findings?: RuntimeTestFinding[];
}

interface RuntimeProbeTest {
  status: string;
  id: string;
  name?: string;
  error?: string;
}

interface RuntimeProbeData {
  sceneName?: string;
  tests?: RuntimeProbeTest[];
}

interface RuntimeExecution {
  attempted?: boolean;
  method?: string;
  status?: string;
  detail?: string;
  browserPath?: string;
  error?: string;
  signal?: string;
  probe?: RuntimeProbeData;
}

interface RuntimeTestPlan {
  tests?: { id: string; name: string }[];
}

interface RuntimeTestSummary {
  tests: number;
  staticBlockingFindings: number;
  staticReviewFindings: number;
}

interface RuntimeEventTest {
  generatedAt: string;
  projectRoot: string;
  mode: string;
  status: string;
  summary: RuntimeTestSummary;
  staticReview?: StaticReview;
  runtime?: RuntimeExecution;
  plan?: RuntimeTestPlan;
  limitations?: string[];
}

function writeRuntimeEventTestOutputs(report: RuntimeEventTest, outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, "runtime-event-test.json"), report);
  fs.writeFileSync(path.join(outDir, "runtime-event-test.md"), renderRuntimeEventTest(report), "utf8");
}

function renderRuntimeEventTest(report: RuntimeEventTest): string {
  const lines = [];
  lines.push("# Runtime Event Test");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Project: ${report.projectRoot}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push(`Status: ${report.status}`);
  lines.push(`Tests: ${report.summary.tests}`);
  lines.push("");
  lines.push("## Static Review");
  lines.push("");
  const staticReview = report.staticReview || {};
  lines.push(`Status: ${staticReview.status || "(unknown)"}`);
  lines.push(`Blocking findings: ${report.summary.staticBlockingFindings}`);
  lines.push(`Review findings: ${report.summary.staticReviewFindings}`);
  lines.push("");
  if ((staticReview.findings || []).length) {
    for (const finding of staticReview.findings!) {
      lines.push(`- [${finding.severity}] ${finding.code}: ${finding.message}`);
    }
  } else {
    lines.push("- No static runtime-test findings.");
  }
  lines.push("");
  lines.push("## Runtime Execution");
  lines.push("");
  const runtime = report.runtime || {};
  lines.push(`- Attempted: ${runtime.attempted ? "yes" : "no"}`);
  lines.push(`- Method: ${runtime.method || "(none)"}`);
  lines.push(`- Status: ${runtime.status || "(unknown)"}`);
  if (runtime.detail) lines.push(`- Detail: ${runtime.detail}`);
  if (runtime.browserPath) lines.push(`- Browser: ${runtime.browserPath}`);
  if (runtime.error) lines.push(`- Error: ${runtime.error}`);
  if (runtime.signal) lines.push(`- Signal: ${runtime.signal}`);
  if (runtime.probe && runtime.probe.sceneName) lines.push(`- Scene: ${runtime.probe.sceneName}`);
  lines.push("");
  lines.push("## Runtime Test Results");
  lines.push("");
  const runtimeTests = runtime.probe && Array.isArray(runtime.probe.tests) ? runtime.probe.tests : [];
  if (runtimeTests.length) {
    for (const test of runtimeTests) {
      lines.push(`- [${test.status}] ${test.id}: ${test.name || ""}${test.error ? ` - ${test.error}` : ""}`);
    }
  } else {
    for (const test of (report.plan && report.plan.tests || [])) {
      lines.push(`- [planned] ${test.id}: ${test.name}`);
    }
  }
  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  for (const item of report.limitations || []) lines.push(`- ${item}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export { writeRuntimeEventTestOutputs };
