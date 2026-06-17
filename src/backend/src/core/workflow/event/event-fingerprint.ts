// 事件内容指纹（content fingerprint）
//
// 给"地图里实际写入的事件"算一个稳定 hash，用于对账时识别玩家手改了内容。
// 关键约束：指纹必须由读回的磁盘事件对象计算（而非抽象契约），这样
// 放置时记录的基线 hash 与日后重算的 hash 走的是同一套规范化，不会因
// patcher 编译差异而永远 mismatch。
//
// 纳入指纹的"剧情实质"：事件 name + pages（每页的 conditions / trigger /
// priorityType / list 命令）。**排除** 易抖动或与内容无关的字段：
//   - 顶层 id / x / y（放置信息，单独由 placement 管，玩家移动不算改内容）
//   - note（含我们自己会改写的 AIWF:* 标记，重新贴标记不应被当成内容变化）
//   - 页面的 image / 移动相关字段（外观/行走，非剧情逻辑）

import crypto from "node:crypto";
import { removeStoryPageMarker } from "../../rmmv/story-page-identity.ts";

interface MapEventLike {
  name?: unknown;
  pages?: unknown;
  [key: string]: unknown;
}

/** 递归按 key 排序后稳定序列化，消除键顺序差异带来的假阳性。 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** 抽取一页里参与指纹的子集（剧情逻辑，不含外观/移动）。 */
function pageDigestShape(page: unknown): Record<string, unknown> {
  const clean = removeStoryPageMarker(page);
  const p = (clean && typeof clean === "object" ? clean : {}) as Record<string, unknown>;
  return {
    conditions: p.conditions ?? {},
    trigger: p.trigger ?? 0,
    priorityType: p.priorityType ?? 0,
    list: Array.isArray(p.list) ? p.list : [],
  };
}

/** 抽取事件里参与指纹的"剧情实质"子集。 */
export function eventContentShape(event: MapEventLike | null | undefined): Record<string, unknown> {
  const ev = (event && typeof event === "object" ? event : {}) as MapEventLike;
  const pages = Array.isArray(ev.pages) ? ev.pages : [];
  return {
    name: typeof ev.name === "string" ? ev.name : "",
    pages: pages.map(pageDigestShape),
  };
}

/** 计算地图事件的内容指纹（sha256 十六进制串）。 */
export function eventContentFingerprint(event: MapEventLike | null | undefined): string {
  const shape = canonicalize(eventContentShape(event));
  return crypto.createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}
