import fs from "fs";
import path from "path";

import { resolveCliOutRoot, resolveWorkflowRoot } from "../workspace-paths.ts";

interface PrepareOutputOptions {
  replaceOutput?: boolean;
  cwd?: string;
}

function prepareOutputPath(targetPath: string, options?: PrepareOutputOptions): string {
  const resolved: string = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) return resolved;
  if (!options || !options.replaceOutput) {
    throw new Error(`Refusing to overwrite existing output path: ${resolved}`);
  }
  assertGeneratedOutPath(resolved, options.cwd || process.cwd());
  fs.rmSync(resolved, { recursive: true, force: true });
  return resolved;
}

function assertGeneratedOutPath(targetPath: string, cwd: string): void {
  const outRoot: string = resolveCliOutRoot(resolveWorkflowRoot(cwd));
  const resolved: string = path.resolve(targetPath);
  const relative: string = path.relative(outRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`--replace-output only removes generated paths inside ${outRoot}: ${resolved}`);
  }
}

export { prepareOutputPath };
