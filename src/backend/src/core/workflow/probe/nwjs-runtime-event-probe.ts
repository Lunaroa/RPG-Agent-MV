import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { RpgMakerEngine } from "../../rmmv/rpg-maker-engine.ts";
import { inspectRmmvProject } from "../../rmmv/rmmv-layout.ts";
import {
  RPG_MAKER_MZ_PROJECT_RUNTIME_COPY_EXCLUSIONS,
  resolveRpgMakerMZProjectRuntime,
} from "../../desktop/rpg-maker-mz-runtime.ts";

interface ProbeResult {
  status: string;
  detail?: string;
  [key: string]: unknown;
}

interface RuntimeResult {
  attempted: boolean;
  method: string;
  status: string;
  detail: string;
  gameExe?: string;
  probe?: ProbeResult;
  [key: string]: unknown;
}

interface NwjsRuntimeEventProbeOptions {
  timeoutMs?: number;
  engine?: RpgMakerEngine;
}

function runNwjsRuntimeEventProbe(projectRoot: string, plan: unknown, options: NwjsRuntimeEventProbeOptions = {}): RuntimeResult {
  const project: string = path.resolve(projectRoot);
  let engine: RpgMakerEngine;
  try {
    engine = inspectRmmvProject(project).engine;
  } catch (error) {
    return runtimeResult("nwjs", "not-available", error instanceof Error ? error.message : String(error));
  }
  if (options.engine && options.engine !== engine) {
    return runtimeResult("nwjs", "fail", `Runtime probe engine ${options.engine} does not match project engine ${engine}.`);
  }

  let executable: string;
  if (engine === "rpg-maker-mz") {
    try {
      executable = resolveRpgMakerMZProjectRuntime(project).executable;
    } catch (error) {
      return runtimeResult("nwjs", "not-available", error instanceof Error ? error.message : String(error));
    }
  } else {
    executable = path.join(project, "Game.exe");
    if (!fs.existsSync(executable)) {
      return runtimeResult("nwjs", "not-available", "Game.exe was not found in the RPG Maker MV source project.");
    }
  }

  const timeoutMs: number = options.timeoutMs || 12000;
  const tempRoot: string = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-agent-runtime-event-"));
  const temporaryProject = path.join(tempRoot, "project");
  const resultPath: string = path.join(tempRoot, "runtime-event-result.json");
  try {
    copyProjectForProbe(project, temporaryProject, engine);
    injectRuntimeProbe(temporaryProject, resultPath, plan, timeoutMs, engine);
    const gameExe = engine === "rpg-maker-mv" ? path.join(temporaryProject, "Game.exe") : executable;
    const args = engine === "rpg-maker-mz" ? [temporaryProject, "--disable-audio"] : ["--disable-audio"];
    const child = childProcess.spawn(gameExe, args, {
      cwd: temporaryProject,
      windowsHide: true,
      stdio: "ignore"
    });
    const probe: ProbeResult = waitForProbeResult(resultPath, child, timeoutMs + 6000);
    stopProcess(child);
    return {
      attempted: true,
      method: "nwjs",
      status: probe.status === "pass" ? "pass" : "fail",
      detail: probe.detail || (probe.status === "pass" ? "All NW.js runtime event tests passed." : "NW.js runtime event tests failed."),
      gameExe: engine === "rpg-maker-mz" ? "project-local-rpg-maker-mz-nwjs" : "isolated-rpg-maker-mv-nwjs",
      engine,
      probe
    };
  } catch (error) {
    return runtimeResult("nwjs", "fail", (error as Error).message, { engine });
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (e) {
      console.warn('[nwjs-runtime-event-probe] Failed to cleanup temp dir:', tempRoot, e);
    }
  }
}

function injectRuntimeProbe(project: string, resultPath: string, plan: unknown, timeoutMs: number, engine: RpgMakerEngine): void {
  const www: string = inspectRmmvProject(project).resourceRoot;
  const indexPath: string = path.join(www, "index.html");
  if (!fs.existsSync(indexPath)) throw new Error(`Cannot inject runtime event probe; index.html not found at ${indexPath}`);
  const probePath: string = path.join(www, "js", "AIWF_RuntimeEventProbe.js");
  fs.writeFileSync(probePath, renderRuntimeProbeScript(resultPath, plan, timeoutMs, engine), "utf8");
  const html: string = fs.readFileSync(indexPath, "utf8");
  if (html.includes("AIWF_RuntimeEventProbe.js")) return;
  const scriptTag = '        <script type="text/javascript" src="js/AIWF_RuntimeEventProbe.js"></script>\n';
  const marker = /(\s*<script[^>]+src=["']js\/main\.js["'][^>]*><\/script>)/i;
  const nextHtml: string = marker.test(html)
    ? html.replace(marker, `${scriptTag}$1`)
    : html.replace(/<\/body>/i, `${scriptTag}</body>`);
  fs.writeFileSync(indexPath, nextHtml, "utf8");
}

function waitForProbeResult(resultPath: string, child: childProcess.ChildProcess, timeoutMs: number): ProbeResult {
  const deadline: number = Date.now() + timeoutMs;
  let last: ProbeResult | null = null;
  while (Date.now() < deadline) {
    if (fs.existsSync(resultPath)) {
      try {
        last = JSON.parse(fs.readFileSync(resultPath, "utf8")) as ProbeResult;
        if (last.status && last.status !== "running") return last;
      } catch (e) {
        console.warn('[nwjs-runtime-event-probe] Failed to parse probe result, retrying:', e);
      }
    }
    if (child.exitCode !== null) {
      return last || { status: "fail", detail: `Game.exe exited before runtime event probe finished with code ${child.exitCode}.` };
    }
    sleep(250);
  }
  return last || { status: "fail", detail: "Timed out before runtime event probe produced a final result." };
}

function stopProcess(child: childProcess.ChildProcess): void {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill();
  } catch (e) {
    // Fall through to taskkill.
    console.warn('[nwjs-runtime-event-probe] Failed to kill child process, falling back to taskkill:', e);
  }
  if (process.platform === "win32" && child.pid) {
    childProcess.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
  }
}

function sleep(ms: number): void {
  const until: number = Date.now() + ms;
  while (Date.now() < until) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(100, until - Date.now()));
  }
}

function runtimeResult(method: string, status: string, detail: string, extra: Record<string, unknown> = {}): RuntimeResult {
  return {
    attempted: status !== "not-available",
    method,
    status,
    detail,
    ...extra
  };
}

function renderRuntimeProbeScript(resultPath: string, plan: unknown, timeoutMs: number, engine: RpgMakerEngine): string {
  const planEnvelope = Array.isArray(plan) ? { engine, tests: plan } : plan;
  const planJson: string = JSON.stringify(planEnvelope).replace(/</g, "\\u003c");
  return `/* eslint-disable */
(function () {
  var fs = null;
  try { fs = require("fs"); } catch (_error) {}
  var resultPath = ${JSON.stringify(resultPath)};
  var plan = ${planJson};
  var startedAt = Date.now();
  var timeoutMs = ${JSON.stringify(timeoutMs)};
  var errors = [];
  var okTimer = null;

  window.addEventListener("error", function (event) {
    errors.push(String(event.message || event.error || "runtime error"));
  });
  window.addEventListener("unhandledrejection", function (event) {
    errors.push(String(event.reason || "unhandled rejection"));
  });

  function write(result) {
    result.generatedAt = new Date().toISOString();
    result.elapsedMs = Date.now() - startedAt;
    result.sceneName = sceneName();
    result.errors = errors.slice(0, 20);
    try {
      if (fs) fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    } catch (_error) {}
  }
  function sceneName() {
    var scene = window.SceneManager && window.SceneManager._scene;
    return scene && scene.constructor && scene.constructor.name || null;
  }
  function ready() {
    return Boolean(window.DataManager && window.SceneManager && window.$dataSystem && window.$dataMapInfos && window.$dataCommonEvents);
  }
  function mapSceneReady() {
    var scene = window.SceneManager && window.SceneManager._scene;
    return Boolean(
      scene &&
      scene.constructor &&
      scene.constructor.name === "Scene_Map" &&
      window.$dataMap &&
      window.$gameMap &&
      window.$gamePlayer
    );
  }
  function eventIdle() {
    if (!window.$dataMap || !window.$gameMap || !window.$gamePlayer) return false;
    var interpreter = window.$gameMap && window.$gameMap._interpreter;
    var eventRunning = window.$gameMap && window.$gameMap.isEventRunning && window.$gameMap.isEventRunning();
    var interpreterRunning = interpreter && interpreter.isRunning && interpreter.isRunning();
    var messageBusy = window.$gameMessage && window.$gameMessage.isBusy && window.$gameMessage.isBusy();
    var canMove = window.$gamePlayer && window.$gamePlayer.canMove && window.$gamePlayer.canMove();
    return !eventRunning && !interpreterRunning && !messageBusy && Boolean(canMove);
  }
  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  async function waitUntil(predicate, detail, limitMs) {
    var deadline = Date.now() + (limitMs || 8000);
    while (Date.now() < deadline) {
      if (errors.length) throw new Error("Runtime JavaScript error: " + errors.join("; "));
      if (predicate()) return;
      tickRuntime();
      await sleep(16);
    }
    throw new Error("Timed out waiting for " + detail);
  }
  async function waitForIdleIfPossible(detail, limitMs) {
    var deadline = Date.now() + (limitMs || 3000);
    while (Date.now() < deadline) {
      if (errors.length) throw new Error("Runtime JavaScript error: " + errors.join("; "));
      if (eventIdle()) return true;
      tickRuntime();
      await sleep(16);
    }
    return false;
  }
  async function waitForMapData(mapId, limitMs) {
    var deadline = Date.now() + (limitMs || 8000);
    while (Date.now() < deadline) {
      if (window.$dataMap && window.$dataMap.width && window.$dataMap.height) return;
      await sleep(16);
    }
    throw new Error("Timed out waiting for direct map data load for " + mapId);
  }
  function tickRuntime() {
    try {
      if (window.SceneManager && window.SceneManager._scene && typeof window.SceneManager.updateMain === "function") {
        window.SceneManager.updateMain();
      }
      if (window.$dataMap && window.$gameMap && typeof window.$gameMap.update === "function") {
        window.$gameMap.update(true);
      }
    } catch (error) {
      errors.push(String(error && error.stack || error && error.message || error || "runtime update error"));
    }
  }
  async function waitFrames(frames) {
    var count = Math.max(1, Number(frames || 1));
    for (var index = 0; index < count; index += 1) {
      tickRuntime();
      await sleep(16);
    }
  }
  function directionCode(direction) {
    if (direction === "down" || direction === 2) return 2;
    if (direction === "left" || direction === 4) return 4;
    if (direction === "right" || direction === 6) return 6;
    if (direction === "up" || direction === 8) return 8;
    return Number(direction) || 2;
  }
  function pressOk() {
    if (!window.Input) return;
    window.Input._currentState = window.Input._currentState || {};
    window.Input._currentState.ok = true;
    window.Input._currentState.z = true;
    setTimeout(function () {
      if (window.Input && window.Input._currentState) {
        window.Input._currentState.ok = false;
        window.Input._currentState.z = false;
      }
    }, 60);
  }
  function startOkPulses() {
    if (okTimer) return;
    okTimer = setInterval(pressOk, 120);
  }
  function stopOkPulses() {
    if (!okTimer) return;
    clearInterval(okTimer);
    okTimer = null;
  }
  async function setupNewGame() {
    if (!ready()) throw new Error("RPG Maker runtime is not ready.");
    window.DataManager.setupNewGame();
    if (window.Scene_Map) window.SceneManager.goto(window.Scene_Map);
    await waitUntil(function () {
      return window.$dataMap && window.$gameMap && window.$gameMap.mapId && window.$gameMap.mapId() === window.$dataSystem.startMapId;
    }, "new game start map", 8000);
    await waitUntil(mapSceneReady, "map scene readiness", 8000);
    await waitForIdleIfPossible("start event idle state", 8000);
    await waitFrames(90);
  }
  async function transferTo(step) {
    if (!window.$gamePlayer) throw new Error("Cannot transfer before $gamePlayer exists.");
    if (step.runtime === true) {
      await reserveRuntimeTransfer(step);
      return;
    }
    await setupMapDirect(step);
  }
  async function reserveRuntimeTransfer(step) {
    window.$gamePlayer.reserveTransfer(Number(step.mapId), Number(step.x || 0), Number(step.y || 0), directionCode(step.direction || "down"), 0);
    await waitUntil(function () {
      return window.$dataMap && window.$gameMap && window.$gameMap.mapId && window.$gameMap.mapId() === Number(step.mapId);
    }, "map transfer to " + step.mapId, 8000);
    if (Number.isInteger(step.x) && Number.isInteger(step.y)) window.$gamePlayer.locate(Number(step.x), Number(step.y));
    await waitUntil(mapSceneReady, "map scene readiness", 8000);
    await waitForIdleIfPossible("event idle state", 3000);
    await waitFrames(Math.max(90, Number(step.frames || 30)));
  }
  async function setupMapDirect(step) {
    var mapId = Number(step.mapId);
    if (!Number.isInteger(mapId) || mapId < 1) throw new Error("Invalid transfer mapId: " + step.mapId);
    window.$dataMap = null;
    window.DataManager.loadMapData(mapId);
    await waitForMapData(mapId, 8000);
    window.$gameMap.setup(mapId);
    window.$gamePlayer.locate(Number(step.x || 0), Number(step.y || 0));
    window.$gamePlayer.setDirection(directionCode(step.direction || "down"));
    if (window.$gamePlayer.refresh) window.$gamePlayer.refresh();
    if (window.Scene_Map) window.SceneManager.goto(window.Scene_Map);
    await waitUntil(mapSceneReady, "map scene readiness", 8000);
    await waitForIdleIfPossible("event idle state", 3000);
    await waitFrames(Math.max(90, Number(step.frames || 30)));
  }
  async function interactEvent(step) {
    await waitUntil(mapSceneReady, "map scene readiness", 8000);
    await waitForIdleIfPossible("event idle state before interaction", 3000);
    await sleep(500);
    if (Number.isInteger(step.mapId) && window.$gameMap.mapId() !== Number(step.mapId)) {
      throw new Error("Cannot interact with event on map " + step.mapId + " while current map is " + window.$gameMap.mapId());
    }
    var event = window.$gameMap.event(Number(step.eventId));
    if (!event) throw new Error("Event not found: " + step.eventId);
    event.start();
    await waitFrames(Math.min(30, Number(step.frames || 90)));
    await waitForIdleIfPossible("event idle state after interaction", Math.max(8000, Number(step.frames || 90) * 20));
    await waitFrames(30);
  }
  async function runStep(step, test, stepIndex) {
    var type = step.type || step.action || step.assert;
    if (type === "new-game") await setupNewGame();
    else if (type === "transfer") await transferTo(step);
    else if (type === "wait") await waitFrames(Number(step.frames || 30));
    else if (type === "turn") {
      window.$gamePlayer.setDirection(directionCode(step.direction || "down"));
      await waitFrames(5);
    } else if (type === "move") {
      var steps = Number(step.steps || 1);
      for (var index = 0; index < steps; index += 1) {
        window.$gamePlayer.moveStraight(directionCode(step.direction || "down"));
        await waitFrames(Number(step.frames || 18));
      }
    } else if (type === "interact-event") await interactEvent(step);
    else if (type && type.indexOf("assert-") === 0) assertRuntime(step, test, stepIndex);
    else throw new Error("Unsupported runtime event test step type: " + type);
  }
  function assertRuntime(step, test, stepIndex) {
    var type = step.type || step.assert;
    if (type === "assert-map") {
      assertEqual(window.$gameMap && window.$gameMap.mapId && window.$gameMap.mapId(), Number(step.mapId), step, test, stepIndex);
    } else if (type === "assert-player") {
      assertEqual(window.$gamePlayer.x, Number(step.x), step, test, stepIndex, "x");
      assertEqual(window.$gamePlayer.y, Number(step.y), step, test, stepIndex, "y");
      if (step.direction) assertEqual(window.$gamePlayer.direction(), directionCode(step.direction), step, test, stepIndex, "direction");
    } else if (type === "assert-player-visible") {
      assertEqual(!window.$gamePlayer.isTransparent(), step.value !== false, step, test, stepIndex, "visible");
      if (step.characterName) assertEqual(window.$gamePlayer.characterName(), step.characterName, step, test, stepIndex, "characterName");
    } else if (type === "assert-switch") {
      assertEqual(Boolean(window.$gameSwitches.value(Number(step.id))), Boolean(step.value), step, test, stepIndex);
    } else if (type === "assert-variable") {
      assertEqual(window.$gameVariables.value(Number(step.id)), step.value, step, test, stepIndex);
    } else if (type === "assert-self-switch") {
      var key = [Number(step.mapId || window.$gameMap.mapId()), Number(step.eventId), step.selfSwitch || "A"];
      assertEqual(Boolean(window.$gameSelfSwitches.value(key)), Boolean(step.value), step, test, stepIndex);
    } else if (type === "assert-event-position") {
      var event = window.$gameMap.event(Number(step.eventId));
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
  async function runTest(test) {
    var steps = [];
    if (test.start) steps.push({ type: "new-game" }, Object.assign({ type: "transfer" }, test.start));
    for (var index = 0; index < (test.steps || []).length; index += 1) steps.push(test.steps[index]);
    for (var expectedIndex = 0; expectedIndex < (test.expectations || []).length; expectedIndex += 1) steps.push(test.expectations[expectedIndex]);
    var executed = [];
    for (var stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      await runStep(steps[stepIndex], test, stepIndex);
      executed.push({ index: stepIndex, type: steps[stepIndex].type || steps[stepIndex].action || steps[stepIndex].assert });
    }
    return { id: test.id, name: test.name, status: "pass", steps: executed };
  }
  async function run() {
    write({ status: "running", detail: "Waiting for runtime readiness." });
    await waitUntil(ready, "RPG Maker runtime readiness", Math.min(timeoutMs, 12000));
    startOkPulses();
    var tests = [];
    for (var index = 0; index < (plan.tests || []).length; index += 1) {
      var test = plan.tests[index];
      try {
        tests.push(await runTest(test));
      } catch (error) {
        tests.push({ id: test.id, name: test.name, status: "fail", error: String(error && error.message || error) });
      }
    }
    stopOkPulses();
    var failed = tests.filter(function (item) { return item.status === "fail"; });
    write({
      status: failed.length ? "fail" : "pass",
      detail: failed.length ? failed.length + " runtime event test(s) failed." : "All runtime event tests passed.",
      tests: tests
    });
    setTimeout(function () { window.close(); }, 100);
  }
  setTimeout(function () {
    write({ status: "fail", detail: "Runtime event probe timed out.", tests: [] });
    try { window.close(); } catch (_error) {}
  }, timeoutMs);
  run().catch(function (error) {
    stopOkPulses();
    write({
      status: "fail",
      detail: String(error && error.message || error),
      stack: error && error.stack ? String(error.stack).slice(0, 2000) : "",
      tests: []
    });
    try { window.close(); } catch (_error) {}
  });
}());
`;
}

function copyProjectForProbe(sourceProject: string, temporaryProject: string, engine: RpgMakerEngine): void {
  const exclusions = new Set(
    (engine === "rpg-maker-mz" ? RPG_MAKER_MZ_PROJECT_RUNTIME_COPY_EXCLUSIONS : [])
      .map((entry) => entry.toLowerCase()),
  );
  fs.mkdirSync(temporaryProject, { recursive: true });
  fs.cpSync(sourceProject, temporaryProject, {
    recursive: true,
    force: true,
    filter(source) {
      const relative = path.relative(sourceProject, source).replace(/\\/g, "/");
      if (!relative) return true;
      const lower = relative.toLowerCase();
      if (lower === "save" || lower.startsWith("save/") || lower === "www/save" || lower.startsWith("www/save/")) return false;
      const rootEntry = lower.split("/")[0];
      return !exclusions.has(rootEntry);
    },
  });
}

export { copyProjectForProbe, renderRuntimeProbeScript, runNwjsRuntimeEventProbe };
