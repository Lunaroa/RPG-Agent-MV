// 编排脚本 Worker：在独立线程里跑 vm.runInContext，agent/log 经 parentPort RPC 回主进程。
// Worker 不接收宿主 Promise/函数，只处理结构化消息；挂死时主进程 worker.terminate() 杀掉线程。

import vm from "node:vm";
import { parentPort } from "node:worker_threads";

const WORKFLOW_ABORTED = "WorkflowAbortedError";

type WorkerInbound =
  | {
      type: "run";
      script: string;
      argsJson?: string;
      project: string;
      syncTimeoutMs: number;
    }
  | { type: "abort" };

type WorkerOutbound =
  | { type: "rpc"; id: number; method: "agent" | "log"; args: unknown }
  | { type: "done"; value: unknown }
  | { type: "fail"; message: string; name?: string };

type ParentToWorker =
  | { type: "rpc-result"; id: number; value: unknown }
  | { type: "rpc-error"; id: number; message: string; name?: string };

type RpcOutbound = { id: number; method: "agent" | "log"; args: unknown };
type RpcInbound =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; message: string; name?: string };

let nextRpcId = 1;
let aborted = false;

const pendingRpc = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

function postRpc(method: "agent" | "log", args: unknown): Promise<unknown> {
  if (aborted) {
    return Promise.reject(new Error("workflow aborted during script execution"));
  }
  const id = nextRpcId++;
  const promise = new Promise<unknown>((resolve, reject) => {
    pendingRpc.set(id, { resolve, reject });
  });
  parentPort!.postMessage({ type: "rpc", id, method, args } satisfies WorkerOutbound);
  return promise;
}

function settleRpc(id: number, result: { ok: true; value: unknown } | { ok: false; error: Error }): void {
  const entry = pendingRpc.get(id);
  if (!entry) return;
  pendingRpc.delete(id);
  if (result.ok) entry.resolve(result.value);
  else entry.reject(result.error);
}

function rejectAllPending(message: string, name?: string): void {
  const err = new Error(message);
  if (name) err.name = name;
  for (const [, entry] of pendingRpc) entry.reject(err);
  pendingRpc.clear();
}

const PRIMITIVES_SOURCE = `"use strict";
var __rpcPending = new Map();
function __flushInbound() {
  while (__rpcInbound.length) {
    var msg = __rpcInbound.shift();
    var pending = __rpcPending.get(msg.id);
    if (!pending) continue;
    __rpcPending.delete(msg.id);
    if (msg.ok) pending.resolve(msg.value);
    else {
      var err = new Error(msg.message || "rpc error");
      if (msg.name) err.name = msg.name;
      pending.reject(err);
    }
  }
}
function __enqueueRpc(method, args) {
  return new Promise(function(resolve, reject) {
    var id = __rpcOutbound.length + __rpcPending.size + 1;
    __rpcPending.set(id, { resolve: resolve, reject: reject });
    __rpcOutbound.push({ id: id, method: method, args: args });
  });
}
function agent(req) {
  return __enqueueRpc("agent", req);
}
async function parallel(thunks) {
  return Promise.all(thunks.map(async function(thunk) {
    try { return await thunk(); }
    catch (e) {
      if (e && e.name === "${WORKFLOW_ABORTED}") throw e;
      return null;
    }
  }));
}
async function pipeline(items) {
  var stages = Array.prototype.slice.call(arguments, 1);
  return Promise.all(items.map(async function(item, index) {
    var value = item;
    for (var i = 0; i < stages.length; i++) {
      try { value = await stages[i](value, item, index); }
      catch (e) {
        if (e && e.name === "${WORKFLOW_ABORTED}") throw e;
        return null;
      }
    }
    return value;
  }));
}
function log(message) { void __enqueueRpc("log", message); }
globalThis.agent = agent;
globalThis.parallel = parallel;
globalThis.pipeline = pipeline;
globalThis.log = log;`;

/** 在单一 vm 上下文内安装原语；RPC 只经 __rpcOutbound/__rpcInbound 结构化队列，不暴露宿主函数。 */
function createScriptContext(message: Extract<WorkerInbound, { type: "run" }>): {
  context: vm.Context;
  rpcOutbound: RpcOutbound[];
  rpcInbound: RpcInbound[];
} {
  const rpcOutbound: RpcOutbound[] = [];
  const rpcInbound: RpcInbound[] = [];
  const sandbox: Record<string, unknown> = {
    project: message.project,
    __argsJson: message.argsJson,
    __rpcOutbound: rpcOutbound,
    __rpcInbound: rpcInbound,
    console: Object.assign(Object.create(null), {
      log: (...parts: unknown[]) => {
        rpcOutbound.push({
          id: rpcOutbound.length + 1,
          method: "log",
          args: parts.map(String).join(" "),
        });
      },
    }),
  };
  const context = vm.createContext(sandbox, { name: "workflow-script" });
  vm.runInContext(PRIMITIVES_SOURCE, context, { filename: "workflow-script-primitives.js" });
  return { context, rpcOutbound, rpcInbound };
}

async function pumpRpcQueues(
  context: vm.Context,
  rpcOutbound: RpcOutbound[],
  rpcInbound: RpcInbound[],
): Promise<void> {
  // 批量并发派发：parallel/pipeline 在首个 await 前会把多条 agent RPC 同步入队 __rpcOutbound，
  // 父进程 worker.on("message") 也是 fire-and-forget 并发处理。这里把当前队列一次性全发出去并发等回结果，
  // 再统一回填；逐条 await 会把 parallel 退化成串行（最大并发 1）。
  if (rpcOutbound.length === 0) return;
  const batch = rpcOutbound.splice(0, rpcOutbound.length);
  const results = await Promise.all(
    batch.map(async (msg) => {
      if (msg.method === "log") {
        await postRpc("log", msg.args);
        return null;
      }
      try {
        const value = await postRpc("agent", msg.args);
        return { id: msg.id, ok: true as const, value };
      } catch (error) {
        return {
          id: msg.id,
          ok: false as const,
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : undefined,
        };
      }
    }),
  );
  for (const result of results) {
    if (result) rpcInbound.push(result);
  }
  vm.runInContext("__flushInbound()", context);
}

async function runUntilSettled(
  pending: Promise<unknown>,
  context: vm.Context,
  rpcOutbound: RpcOutbound[],
  rpcInbound: RpcInbound[],
): Promise<unknown> {
  for (;;) {
    if (aborted) {
      const err = new Error("workflow aborted during script execution");
      err.name = WORKFLOW_ABORTED;
      throw err;
    }
    await pumpRpcQueues(context, rpcOutbound, rpcInbound);
    const raced = await Promise.race([
      pending.then(
        (value) => ({ kind: "done" as const, value }),
        (error) => ({ kind: "error" as const, error }),
      ),
      new Promise<{ kind: "tick" }>((resolve) => setImmediate(() => resolve({ kind: "tick" }))),
    ]);
    if (raced.kind === "done") {
      await pumpRpcQueues(context, rpcOutbound, rpcInbound);
      return raced.value;
    }
    if (raced.kind === "error") throw raced.error;
  }
}

async function runScript(message: Extract<WorkerInbound, { type: "run" }>): Promise<void> {
  const { context, rpcOutbound, rpcInbound } = createScriptContext(message);
  const wrapped = `(async () => {
"use strict";
const args = typeof __argsJson === "undefined" ? undefined : JSON.parse(__argsJson);
${message.script}
})()`;

  let pending: unknown;
  try {
    pending = vm.runInContext(wrapped, context, {
      filename: "workflow-script.js",
      timeout: message.syncTimeoutMs,
    });
  } catch (error) {
    parentPort!.postMessage({
      type: "fail",
      message: `编排脚本编译/启动失败：${error instanceof Error ? error.message : String(error)}`,
    } satisfies WorkerOutbound);
    return;
  }

  try {
    const value = await runUntilSettled(pending as Promise<unknown>, context, rpcOutbound, rpcInbound);
    if (aborted) {
      parentPort!.postMessage({
        type: "fail",
        message: "workflow aborted during script execution",
        name: WORKFLOW_ABORTED,
      } satisfies WorkerOutbound);
      return;
    }
    parentPort!.postMessage({ type: "done", value } satisfies WorkerOutbound);
  } catch (error) {
    if (aborted) {
      parentPort!.postMessage({
        type: "fail",
        message: "workflow aborted during script execution",
        name: WORKFLOW_ABORTED,
      } satisfies WorkerOutbound);
      return;
    }
    parentPort!.postMessage({
      type: "fail",
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : undefined,
    } satisfies WorkerOutbound);
  }
}

parentPort!.on("message", (raw: WorkerInbound | ParentToWorker) => {
  if (raw.type === "abort") {
    aborted = true;
    rejectAllPending("workflow aborted during script execution", WORKFLOW_ABORTED);
    return;
  }
  if (raw.type === "rpc-result") {
    settleRpc(raw.id, { ok: true, value: raw.value });
    return;
  }
  if (raw.type === "rpc-error") {
    const err = new Error(raw.message);
    if (raw.name) err.name = raw.name;
    settleRpc(raw.id, { ok: false, error: err });
    return;
  }
  if (raw.type === "run") {
    void runScript(raw);
  }
});
