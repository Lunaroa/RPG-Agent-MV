import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ripgrepDownloadFailed,
  ripgrepEmptyArchive,
  ripgrepExecutableMissing,
} from "./buildOpencodeRuntimeLocalization.ts";

const root = process.cwd();
const opencodeRoot = join(root, "third_party", "opencode");
const packageJsonPath = join(opencodeRoot, "packages", "opencode", "package.json");
const lockfilePath = join(opencodeRoot, "bun.lock");
const outputBinary = join(opencodeRoot, "packages", "opencode", "dist", "opencode-windows-x64", "bin", "opencode.exe");
const runtimeOutDir = join(root, "runtime", "out", "opencode", "windows-x64");
const runtimeBinary = join(runtimeOutDir, "opencode.exe");
// Pinned to the same ripgrep release the opencode runtime would otherwise
// download on first use (packages/core/src/ripgrep/binary.ts).
const RIPGREP_VERSION = "15.1.0";
const ripgrepBinary = join(runtimeOutDir, "rg.exe");

function run(command: string, env: NodeJS.ProcessEnv = process.env): void {
  execSync(command, {
    cwd: root,
    env,
    stdio: "inherit",
  });
}

if (!existsSync(packageJsonPath) || !existsSync(lockfilePath)) {
  throw new Error("missing vendored opencode source; expected third_party/opencode at v1.17.7");
}

run("bun install --cwd third_party/opencode --frozen-lockfile");

const packageJsonBefore = readFileSync(packageJsonPath);
const lockfileBefore = readFileSync(lockfilePath);

try {
  run("bun run --cwd third_party/opencode/packages/opencode build --single --skip-embed-web-ui", {
    ...process.env,
    OPENCODE_CHANNEL: "latest",
    OPENCODE_VERSION: "1.17.7",
  });

  if (!existsSync(outputBinary)) {
    throw new Error(`missing built opencode runtime: ${outputBinary}`);
  }

  mkdirSync(runtimeOutDir, { recursive: true });
  copyFileSync(outputBinary, runtimeBinary);
} finally {
  // The upstream build installs native helper packages and rewrites these files.
  writeFileSync(packageJsonPath, packageJsonBefore);
  writeFileSync(lockfilePath, lockfileBefore);
}

await ensureRipgrep();

/**
 * Bundle ripgrep next to opencode so packaged installs search files fully
 * offline. The opencode runtime otherwise downloads `rg` from GitHub on first
 * use; we ship the pinned version instead. Reuses an existing copy when present.
 */
async function ensureRipgrep(): Promise<void> {
  if (existsSync(ripgrepBinary)) {
    console.log(`[build] reusing existing ripgrep: ${ripgrepBinary}`);
    return;
  }

  mkdirSync(runtimeOutDir, { recursive: true });
  const platform = "x86_64-pc-windows-msvc";
  const dirName = `ripgrep-${RIPGREP_VERSION}-${platform}`;
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${dirName}.zip`;
  const archive = join(runtimeOutDir, `${dirName}.zip`);
  const extractDir = join(runtimeOutDir, `${dirName}-extract`);

  console.log(`[build] downloading ripgrep ${RIPGREP_VERSION} from ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(ripgrepDownloadFailed(url, response.status, 'en-US'));
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error(ripgrepEmptyArchive(url, 'en-US'));
  }
  writeFileSync(archive, bytes);

  rmSync(extractDir, { recursive: true, force: true });
  const psCommand = `$ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${extractDir.replaceAll("'", "''")}' -Force`;
  run(`powershell -NoProfile -NonInteractive -Command "${psCommand}"`);

  const extracted = join(extractDir, dirName, "rg.exe");
  if (!existsSync(extracted)) {
    throw new Error(ripgrepExecutableMissing(extracted, 'en-US'));
  }
  copyFileSync(extracted, ripgrepBinary);
  rmSync(archive, { force: true });
  rmSync(extractDir, { recursive: true, force: true });
  console.log(`[build] ripgrep ready: ${ripgrepBinary}`);
}
