import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  PATHS,
  resolveWorkflowRoot,
} from "../core/workspace-paths.ts";

const PYTHON: string = process.env.PYTHON || "python";

interface RunPythonOptions {
  cwd?: string;
  timeout?: number;
  silent?: boolean;
}

function pythonPathEnv(workflowRoot: string): Record<string, string> {
  const srcPy = path.join(workflowRoot, PATHS.pyRoot);
  const legacyPy = path.join(workflowRoot, PATHS.pyRootLegacy);
  const pyRoot = fs.existsSync(srcPy) ? srcPy : legacyPy;
  const existing = process.env.PYTHONPATH?.trim();
  const merged = existing ? `${pyRoot}${path.delimiter}${existing}` : pyRoot;
  return { PYTHONPATH: merged };
}

function runPython(module: string, args: string[], options: RunPythonOptions = {}): string | null {
  const cwd: string = options.cwd || resolveWorkflowRoot(import.meta.dirname);
  const result = spawnSync(PYTHON, ["-m", module, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || 60000,
    stdio: options.silent ? "pipe" : "inherit",
    env: { ...process.env, ...pythonPathEnv(cwd) },
  });

  if (result.error) {
    throw new Error(`Python spawn error: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Python exited with code ${result.status}`);
  }
  return result.stdout;
}

export { runPython };
