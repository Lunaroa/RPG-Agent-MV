import { EventContractDao } from "../db/dao/event-contract-dao.ts";
import { renderEventScript, type EventScriptModel } from "../rmmv/event-script.ts";

export type EventScriptResult =
  | { status: "ok"; script: EventScriptModel }
  | { status: "not-found"; contractId: string };

/**
 * 放置前剧本预览的数据入口：按 contractId 单行查 SQLite（DAO.get），再交渲染器翻成人话剧本。
 * 走单行查询而非 loadRegistry 全表扫描 —— 展开剧本是高频交互，必须快。
 * 查不到（agent 尚未把完整事件登记进注册表）返回 not-found，由前端给出友好空态，不报错。
 */
export function getEventScript(contractId: string): EventScriptResult {
  const id = String(contractId || "").trim();
  if (!id) return { status: "not-found", contractId: id };
  const row = EventContractDao.get(id);
  if (!row) return { status: "not-found", contractId: id };
  // row.contract is the actual JSON contract blob (with id, rmmvTarget, implementation …).
  // The DAO wrapper itself has rid/contract_id/project_id but NOT the content fields, so
  // we must pass row.contract to renderEventScript, not the wrapper object.
  return { status: "ok", script: renderEventScript(row.contract as unknown as Parameters<typeof renderEventScript>[0]) };
}
