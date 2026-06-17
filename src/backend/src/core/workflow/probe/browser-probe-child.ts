#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";

interface ProbeResult {
  status: string;
  detail?: string;
  [key: string]: unknown;
}

interface RunBrowserResult {
  status: string;
  detail: string;
  stderr?: string;
  exitCode?: number | null;
  probe?: ProbeResult;
}

async function main(): Promise<void> {
  const [webRootArg, browserPath, timeoutArg] = process.argv.slice(2);
  const webRoot: string = path.resolve(webRootArg);
  const timeoutMs: number = Number(timeoutArg) || 8000;
  const server: http.Server = createProbeServer(webRoot);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const addr = server.address();
    const port: number = typeof addr === "object" && addr !== null ? addr.port : 0;
    const result: RunBrowserResult = await runBrowser(browserPath, `http://127.0.0.1:${port}/__rmmv_probe.html`, timeoutMs);
    write(result);
  } finally {
    server.close();
  }
}

function runBrowser(browserPath: string, url: string, timeoutMs: number): Promise<RunBrowserResult> {
  return new Promise<RunBrowserResult>((resolve) => {
    const userDataDir: string = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-agent-browser-"));
    const child = childProcess.spawn(browserPath, [
      "--headless=new",
      "--disable-gpu",
      "--disable-audio",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userDataDir}`,
      `--virtual-time-budget=${timeoutMs}`,
      "--dump-dom",
      url
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ status: "fail", detail: "Browser probe timed out.", stderr });
    }, timeoutMs + 5000);
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      resolve({ status: "fail", detail: error.message, stderr });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const probe: ProbeResult | null = extractProbeResult(stdout);
      if (!probe) {
        resolve({
          status: "fail",
          detail: "Browser ran but the probe result was not found in dumped DOM.",
          exitCode: code,
          stderr: truncate(stderr, 2000)
        });
        return;
      }
      resolve({ status: probe.status === "pass" ? "pass" : "fail", detail: probe.detail || "", exitCode: code, probe, stderr: truncate(stderr, 2000) });
    });
  });
}

function createProbeServer(webRoot: string): http.Server {
  return http.createServer((request: http.IncomingMessage, response: http.ServerResponse) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/__rmmv_probe.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(renderProbeHtml());
      return;
    }
    const filePath: string | null = safeStaticPath(webRoot, decodeURIComponent(url.pathname));
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": contentType(filePath) });
    fs.createReadStream(filePath).pipe(response);
  });
}

function safeStaticPath(webRoot: string, requestPath: string): string | null {
  const relative: string = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const resolved: string = path.resolve(webRoot, relative);
  return resolved.startsWith(path.resolve(webRoot)) ? resolved : null;
}

function contentType(filePath: string): string {
  const ext: string = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".m4a") return "audio/mp4";
  return "application/octet-stream";
}

function renderProbeHtml(): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>RMMV Playability Probe</title>
<pre id="result">{"status":"running"}</pre>
<iframe id="game" src="/index.html" style="width:816px;height:624px;border:0"></iframe>
<script>
(function () {
  const startedAt = Date.now();
  const resultEl = document.getElementById("result");
  const iframe = document.getElementById("game");
  const errors = [];
  window.addEventListener("error", function (event) {
    errors.push(String(event.message || event.error || "unknown error"));
  });
  window.addEventListener("unhandledrejection", function (event) {
    errors.push(String(event.reason || "unhandled rejection"));
  });
  function write(result) {
    result.elapsedMs = Date.now() - startedAt;
    resultEl.textContent = JSON.stringify(result);
  }
  function sample() {
    let win = null;
    let doc = null;
    try {
      win = iframe.contentWindow;
      doc = iframe.contentDocument;
      if (win && !win.__rmmvProbeErrorsAttached) {
        win.__rmmvProbeErrorsAttached = true;
        win.addEventListener("error", function (event) {
          errors.push(String(event.message || event.error || "game error"));
        });
        win.addEventListener("unhandledrejection", function (event) {
          errors.push(String(event.reason || "game unhandled rejection"));
        });
      }
    } catch (error) {
      write({ status: "fail", detail: "Cannot access game iframe: " + error.message, errors });
      return;
    }
    const scene = win && win.SceneManager && win.SceneManager._scene;
    const sceneName = scene && scene.constructor && scene.constructor.name || null;
    const canvas = doc && doc.querySelector("canvas");
    const ready = Boolean(win && win.SceneManager && win.DataManager && win.Graphics && win.$dataSystem);
    const booted = ready && Boolean(sceneName || canvas);
    if (errors.length) {
      write({ status: "fail", detail: "JavaScript runtime error while booting game.", sceneName, ready, canvas: Boolean(canvas), errors });
      return;
    }
    if (booted) {
      write({ status: "pass", detail: "RPG Maker MV runtime booted in browser probe.", sceneName, ready, canvas: Boolean(canvas), errors });
      return;
    }
    if (Date.now() - startedAt > 7000) {
      write({ status: "fail", detail: "Timed out before RPG Maker MV runtime became ready.", sceneName, ready, canvas: Boolean(canvas), errors });
      return;
    }
    write({ status: "running", detail: "Waiting for RPG Maker MV runtime.", sceneName, ready, canvas: Boolean(canvas), errors });
    setTimeout(sample, 250);
  }
  setTimeout(sample, 250);
}());
</script>`;
}

function extractProbeResult(dom: string): ProbeResult | null {
  const match: RegExpExecArray | null = /<pre id="result">([\s\S]*?)<\/pre>/i.exec(dom);
  if (!match) return null;
  try {
    return JSON.parse(decodeHtml(match[1])) as ProbeResult;
  } catch (e) {
    console.warn('[browser-probe-child] Failed to parse probe result:', e);
    return null;
  }
}

function decodeHtml(value: string): string {
  return String(value)
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function truncate(value: unknown, limit: number): string {
  const text: string = String(value || "");
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function write(result: unknown): void {
  process.stdout.write(JSON.stringify(result));
}

main().catch((error: unknown) => {
  write({ status: "fail", detail: (error as Error).message });
  process.exitCode = 1;
});
