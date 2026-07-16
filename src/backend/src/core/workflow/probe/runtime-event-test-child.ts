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

interface TestPlan {
  tests?: unknown[];
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const [webRootArg, browserPath, timeoutArg, planPathArg] = process.argv.slice(2);
  const webRoot: string = path.resolve(webRootArg);
  const timeoutMs: number = Number(timeoutArg) || 12000;
  const plan: TestPlan = JSON.parse(fs.readFileSync(path.resolve(planPathArg), "utf8")) as TestPlan;
  const server: http.Server = createProbeServer(webRoot, plan);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const addr = server.address();
    const port: number = typeof addr === "object" && addr !== null ? addr.port : 0;
    const result: RunBrowserResult = await runBrowser(browserPath, `http://127.0.0.1:${port}/__rmmv_runtime_event_test.html`, timeoutMs);
    write(result);
  } finally {
    server.close();
  }
}

function runBrowser(browserPath: string, url: string, timeoutMs: number): Promise<RunBrowserResult> {
  return new Promise<RunBrowserResult>((resolve) => {
    const userDataDir: string = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-agent-runtime-browser-"));
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
      resolve({ status: "fail", detail: "Browser runtime event test timed out.", stderr: truncate(stderr, 2000) });
    }, timeoutMs + 5000);
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      resolve({ status: "fail", detail: error.message, stderr: truncate(stderr, 2000) });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const probe: ProbeResult | null = extractProbeResult(stdout);
      if (!probe) {
        resolve({
          status: "fail",
          detail: "Browser ran but runtime event test result was not found in dumped DOM.",
          exitCode: code,
          stderr: truncate(stderr, 2000)
        });
        return;
      }
      resolve({ status: probe.status === "pass" ? "pass" : "fail", detail: probe.detail || "", exitCode: code, probe, stderr: truncate(stderr, 2000) });
    });
  });
}

function createProbeServer(webRoot: string, plan: TestPlan): http.Server {
  return http.createServer((request: http.IncomingMessage, response: http.ServerResponse) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/__rmmv_runtime_event_test.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(renderProbeHtml(plan));
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

function renderProbeHtml(plan: TestPlan): string {
  const planJson: string = JSON.stringify(plan).replace(/</g, "\\u003c");
  return `<!doctype html>
<meta charset="utf-8">
<title>RMMV Runtime Event Test</title>
<pre id="result">{"status":"running"}</pre>
<iframe id="game" src="/index.html" style="width:816px;height:624px;border:0"></iframe>
<script>
(function () {
  const plan = ${planJson};
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
  function gameWindow() {
    return iframe.contentWindow;
  }
  function attachGameErrors(win) {
    if (!win || win.__rmmvRuntimeTestErrorsAttached) return;
    win.__rmmvRuntimeTestErrorsAttached = true;
    win.addEventListener("error", function (event) {
      errors.push(String(event.message || event.error || "game error"));
    });
    win.addEventListener("unhandledrejection", function (event) {
      errors.push(String(event.reason || "game unhandled rejection"));
    });
  }
  function ready(win) {
    return Boolean(win && win.SceneManager && win.DataManager && win.Graphics && win.$dataSystem && win.$dataMapInfos);
  }
  function mapSceneReady(win) {
    const scene = win && win.SceneManager && win.SceneManager._scene;
    return Boolean(
      scene &&
      scene.constructor &&
      scene.constructor.name === "Scene_Map" &&
      win.$dataMap &&
      win.$gameMap &&
      win.$gamePlayer
    );
  }
  function sceneName(win) {
    const scene = win && win.SceneManager && win.SceneManager._scene;
    return scene && scene.constructor && scene.constructor.name || null;
  }
  function update(win, frames) {
    for (let index = 0; index < frames; index += 1) {
      try {
        pulseOk(win, index);
        if (win.SceneManager && win.SceneManager._scene && typeof win.SceneManager.updateMain === "function") {
          win.SceneManager.updateMain();
        }
        if (win.$dataMap && win.$gameMap && typeof win.$gameMap.update === "function") {
          win.$gameMap.update(true);
        }
      } catch (error) {
        errors.push(String(error && error.stack || error && error.message || error || "runtime update error"));
        return;
      }
    }
    setOk(win, false);
  }
  function pulseOk(win, index) {
    if (index % 12 === 0) setOk(win, true);
    if (index % 12 === 6) setOk(win, false);
  }
  function setOk(win, value) {
    if (!win || !win.Input) return;
    win.Input._currentState = win.Input._currentState || {};
    win.Input._currentState.ok = Boolean(value);
    win.Input._currentState.z = Boolean(value);
  }
  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  async function waitUntil(predicate, detail) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const win = gameWindow();
      attachGameErrors(win);
      if (predicate(win)) return;
      if (errors.length) throw new Error("Runtime JavaScript error: " + errors.join("; "));
      await sleep(50);
    }
    throw new Error("Timed out waiting for " + detail);
  }
  function eventIdle(win) {
    if (!win || !win.$dataMap || !win.$gameMap || !win.$gamePlayer) return false;
    const interpreter = win.$gameMap._interpreter;
    const eventRunning = win.$gameMap.isEventRunning && win.$gameMap.isEventRunning();
    const interpreterRunning = interpreter && interpreter.isRunning && interpreter.isRunning();
    const messageBusy = win.$gameMessage && win.$gameMessage.isBusy && win.$gameMessage.isBusy();
    return !eventRunning && !interpreterRunning && !messageBusy;
  }
  async function waitForIdleIfPossible(detail, limitMs) {
    const deadline = Date.now() + (limitMs || 3000);
    while (Date.now() < deadline) {
      const win = gameWindow();
      if (errors.length) throw new Error("Runtime JavaScript error: " + errors.join("; "));
      if (eventIdle(win)) return true;
      update(win, 1);
      await sleep(16);
    }
    return false;
  }
  async function waitForMapData(mapId) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const win = gameWindow();
      if (win.$dataMap && win.$dataMap.width && win.$dataMap.height) return;
      await sleep(16);
    }
    throw new Error("Timed out waiting for direct map data load for " + mapId);
  }
  async function ensureReady() {
    await waitUntil(function (win) { return ready(win); }, "RPG Maker runtime readiness");
  }
  async function setupNewGame() {
    const win = gameWindow();
    if (win.DataManager && typeof win.DataManager.setupNewGame === "function") win.DataManager.setupNewGame();
    if (win.SceneManager && win.Scene_Map && typeof win.SceneManager.goto === "function") win.SceneManager.goto(win.Scene_Map);
    update(win, 30);
    await waitUntil(function (sampleWin) { return mapSceneReady(sampleWin); }, "map scene readiness");
    await waitForIdleIfPossible("start event idle state");
    await sleep(100);
  }
  async function transferTo(step) {
    const win = gameWindow();
    if (!win.$gamePlayer) throw new Error("Cannot transfer before $gamePlayer exists.");
    if (step.runtime !== true) {
      await setupMapDirect(step);
      return;
    }
    win.$gamePlayer.reserveTransfer(Number(step.mapId), Number(step.x || 0), Number(step.y || 0), directionCode(step.direction || "down"), 0);
    update(win, Number(step.frames || 90));
    await waitUntil(function (sampleWin) {
      return sampleWin.$dataMap && sampleWin.$gameMap && sampleWin.$gameMap.mapId && sampleWin.$gameMap.mapId() === Number(step.mapId);
    }, "map transfer to " + step.mapId);
    await waitForIdleIfPossible("event idle state");
    if (Number.isInteger(step.x) && Number.isInteger(step.y)) {
      win.$gamePlayer.locate(Number(step.x), Number(step.y));
      update(win, 8);
    }
  }
  async function setupMapDirect(step) {
    const win = gameWindow();
    const mapId = Number(step.mapId);
    if (!Number.isInteger(mapId) || mapId < 1) throw new Error("Invalid transfer mapId: " + step.mapId);
    win.$dataMap = null;
    win.DataManager.loadMapData(mapId);
    await waitForMapData(mapId);
    win.$gameMap.setup(mapId);
    win.$gamePlayer.locate(Number(step.x || 0), Number(step.y || 0));
    win.$gamePlayer.setDirection(directionCode(step.direction || "down"));
    if (win.$gamePlayer.refresh) win.$gamePlayer.refresh();
    if (win.Scene_Map && win.SceneManager && typeof win.SceneManager.goto === "function") win.SceneManager.goto(win.Scene_Map);
    await waitUntil(function (sampleWin) { return mapSceneReady(sampleWin); }, "map scene readiness");
    await waitForIdleIfPossible("event idle state");
    update(win, Number(step.frames || 90));
  }
  async function runStep(step, test, stepIndex) {
    const type = step.type || step.action || step.assert;
    const win = gameWindow();
    if (type === "new-game") {
      await setupNewGame();
    } else if (type === "transfer") {
      await transferTo(step);
    } else if (type === "wait") {
      update(win, Number(step.frames || 30));
      await sleep(Number(step.ms || 100));
    } else if (type === "turn") {
      win.$gamePlayer.setDirection(directionCode(step.direction || "down"));
      update(win, 4);
    } else if (type === "move") {
      const steps = Number(step.steps || 1);
      for (let index = 0; index < steps; index += 1) {
        win.$gamePlayer.moveStraight(directionCode(step.direction || "down"));
        update(win, Number(step.frames || 18));
        await sleep(30);
      }
    } else if (type === "interact-event") {
      await waitForIdleIfPossible("event idle state before interaction");
      if (Number.isInteger(step.mapId) && win.$gameMap.mapId() !== Number(step.mapId)) {
        throw new Error("Cannot interact with event on map " + step.mapId + " while current map is " + win.$gameMap.mapId());
      }
      const event = win.$gameMap.event(Number(step.eventId));
      if (!event) throw new Error("Event not found: " + step.eventId);
      event.start();
      update(win, Math.min(30, Number(step.frames || 90)));
      await waitForIdleIfPossible("event idle state after interaction", Math.max(8000, Number(step.frames || 90) * 20));
      update(gameWindow(), 30);
      await sleep(100);
    } else if (type && type.indexOf("assert-") === 0) {
      assertRuntime(step, test, stepIndex);
    } else {
      throw new Error("Unsupported runtime event test step type: " + type);
    }
  }
  function assertRuntime(step, test, stepIndex) {
    const type = step.type || step.assert;
    const win = gameWindow();
    if (type === "assert-map") {
      const actual = win.$gameMap && win.$gameMap.mapId && win.$gameMap.mapId();
      assertEqual(actual, Number(step.mapId), step, test, stepIndex);
    } else if (type === "assert-player") {
      assertEqual(win.$gamePlayer.x, Number(step.x), step, test, stepIndex, "x");
      assertEqual(win.$gamePlayer.y, Number(step.y), step, test, stepIndex, "y");
      if (step.direction) assertEqual(win.$gamePlayer.direction(), directionCode(step.direction), step, test, stepIndex, "direction");
    } else if (type === "assert-player-visible") {
      assertEqual(!win.$gamePlayer.isTransparent(), step.value !== false, step, test, stepIndex, "visible");
      if (step.characterName) assertEqual(win.$gamePlayer.characterName(), step.characterName, step, test, stepIndex, "characterName");
    } else if (type === "assert-switch") {
      assertEqual(Boolean(win.$gameSwitches.value(Number(step.id))), Boolean(step.value), step, test, stepIndex);
    } else if (type === "assert-variable") {
      assertEqual(win.$gameVariables.value(Number(step.id)), step.value, step, test, stepIndex);
    } else if (type === "assert-self-switch") {
      const key = [Number(step.mapId || win.$gameMap.mapId()), Number(step.eventId), step.selfSwitch || "A"];
      assertEqual(Boolean(win.$gameSelfSwitches.value(key)), Boolean(step.value), step, test, stepIndex);
    } else if (type === "assert-event-position") {
      const event = win.$gameMap.event(Number(step.eventId));
      if (!event) throw new Error("Event not found for assertion: " + step.eventId);
      assertEqual(event.x, Number(step.x), step, test, stepIndex, "event.x");
      assertEqual(event.y, Number(step.y), step, test, stepIndex, "event.y");
    } else {
      throw new Error("Unsupported assertion type: " + type);
    }
  }
  function assertEqual(actual, expected, step, test, stepIndex, field) {
    if (actual !== expected) {
      throw new Error((test.id || "test") + " step " + stepIndex + " expected " + (field || step.type || step.assert) + " " + JSON.stringify(expected) + " but got " + JSON.stringify(actual));
    }
  }
  function directionCode(direction) {
    if (direction === "down" || direction === 2) return 2;
    if (direction === "left" || direction === 4) return 4;
    if (direction === "right" || direction === 6) return 6;
    if (direction === "up" || direction === 8) return 8;
    return Number(direction) || 2;
  }
  async function runTest(test) {
    const steps = [];
    if (test.start) steps.push({ type: "new-game" }, Object.assign({ type: "transfer" }, test.start));
    for (const step of test.steps || []) steps.push(step);
    for (const step of test.expectations || []) steps.push(step);
    const executed = [];
    for (let index = 0; index < steps.length; index += 1) {
      await runStep(steps[index], test, index);
      executed.push({ index, type: steps[index].type || steps[index].action || steps[index].assert });
    }
    return { id: test.id, name: test.name, status: "pass", steps: executed };
  }
  async function run() {
    await ensureReady();
    const results = [];
    for (const test of plan.tests || []) {
      try {
        results.push(await runTest(test));
      } catch (error) {
        results.push({ id: test.id, name: test.name, status: "fail", error: error.message });
      }
    }
    const failed = results.filter(function (item) { return item.status === "fail"; });
    write({
      status: failed.length ? "fail" : "pass",
      detail: failed.length ? failed.length + " runtime event test(s) failed." : "All runtime event tests passed.",
      sceneName: sceneName(gameWindow()),
      tests: results,
      errors: errors
    });
  }
  run().catch(function (error) {
    write({
      status: "fail",
      detail: error.message,
      stack: error && error.stack ? String(error.stack).slice(0, 2000) : "",
      sceneName: sceneName(gameWindow()),
      errors: errors
    });
  });
}());
</script>`;
}

function extractProbeResult(dom: string): ProbeResult | null {
  const match: RegExpExecArray | null = /<pre id="result">([\s\S]*?)<\/pre>/i.exec(dom);
  if (!match) return null;
  try {
    return JSON.parse(decodeHtml(match[1])) as ProbeResult;
  } catch (_error) {
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
