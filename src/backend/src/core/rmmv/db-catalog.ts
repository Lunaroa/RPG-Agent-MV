import path from "node:path";

import {
  getRmmvDatabaseSchemaByKey,
  type RmmvDatabaseTableKey,
} from "./database-schema.ts";
import { exists, readJson } from "./json.ts";
import { resolveDataDir } from "./project-scanner.ts";

export type RmmvDbTableName = RmmvDatabaseTableKey;

export interface ActorRow {
  id: number;
  name: string;
  classId: number;
  initialLevel: number;
  nickname: string | null;
}

export interface ClassRow {
  id: number;
  name: string;
  expForLevel99: number | null;
}

export interface SkillRow {
  id: number;
  name: string;
  iconIndex: number;
  mpCost: number;
  tpCost: number;
  scope: number;
  occasion: number;
  description: string | null;
}

export interface ItemRow {
  id: number;
  name: string;
  iconIndex: number;
  price: number;
  consumable: boolean;
  scope: number;
  occasion: number;
  description: string | null;
}

export interface WeaponRow {
  id: number;
  name: string;
  iconIndex: number;
  price: number;
  wtypeId: number;
  description: string | null;
}

export interface ArmorRow {
  id: number;
  name: string;
  iconIndex: number;
  price: number;
  atypeId: number;
  etypeId: number;
  description: string | null;
}

export interface StateRow {
  id: number;
  name: string;
  iconIndex: number;
  restriction: number;
  removeAtBattleEnd: boolean;
  removeByDamage: boolean;
  description: string | null;
}

export interface EnemyRow {
  id: number;
  name: string;
  exp: number;
  gold: number;
  battlerName: string | null;
}

export interface TroopRow {
  id: number;
  name: string;
  memberCount: number;
}

export interface TilesetRow {
  id: number;
  name: string;
  mode: number;
  tilesetNames: string[];
}

export interface AnimationRow {
  id: number;
  name: string;
  animation1Name: string | null;
  animation2Name: string | null;
}

export interface CommonEventRow {
  id: number;
  name: string;
  trigger: number;
  switchId: number;
}

export interface SystemRow {
  id: 0;
  name: string;
  gameTitle: string;
  switchCount: number;
  variableCount: number;
  startMapId: number;
  startX: number;
  startY: number;
  partyMembers: number[];
}

export interface TypesRow {
  id: 0;
  name: "Types";
  elements: string[];
  skillTypes: string[];
  weaponTypes: string[];
  armorTypes: string[];
  equipTypes: string[];
}

export interface TermsRow {
  id: 0;
  name: "Terms";
  basicCount: number;
  paramsCount: number;
  commandsCount: number;
  messageCount: number;
}

export type RmmvDbCatalogRow =
  | ActorRow
  | ClassRow
  | SkillRow
  | ItemRow
  | WeaponRow
  | ArmorRow
  | StateRow
  | EnemyRow
  | TroopRow
  | TilesetRow
  | AnimationRow
  | CommonEventRow
  | SystemRow
  | TypesRow
  | TermsRow;

export interface RmmvDbCatalogQuery {
  tables: RmmvDbTableName[];
  query?: string;
  limit?: number;
}

export interface RmmvDbCatalogResult {
  generatedAt: string;
  projectRoot: string;
  dataDir: string;
  query: string | null;
  limit: number;
  tables: Partial<Record<RmmvDbTableName, RmmvDbCatalogRow[]>>;
}

const DEFAULT_LIMIT = 50;

export function buildRmmvDbCatalog(projectRoot: string, query: RmmvDbCatalogQuery): RmmvDbCatalogResult {
  const root = path.resolve(projectRoot);
  const dataDir = resolveDataDir(root);
  const limit = query.limit && Number.isInteger(query.limit) && query.limit > 0 ? query.limit : DEFAULT_LIMIT;
  const needle = (query.query ?? "").trim().toLowerCase();
  const out: Partial<Record<RmmvDbTableName, RmmvDbCatalogRow[]>> = {};

  for (const table of query.tables) {
    const schema = getRmmvDatabaseSchemaByKey(table);
    const file = path.join(dataDir, schema.fileName);
    const raw = exists(file) ? readJson(file) : (schema.isArrayTable ? [] : null);
    const rows = mapRows(table, raw);
    const filtered = needle
      ? rows.filter((row) => row.name.toLowerCase().includes(needle))
      : rows;
    out[table] = filtered.slice(0, limit);
  }

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    dataDir,
    query: needle ? needle : null,
    limit,
    tables: out,
  };
}

function mapRows(table: RmmvDbTableName, raw: unknown): RmmvDbCatalogRow[] {
  const schema = getRmmvDatabaseSchemaByKey(table);
  if (!schema.isArrayTable) return raw && typeof raw === "object" && !Array.isArray(raw) ? [buildDocumentRow(table, raw as Record<string, unknown>)] : [];
  const entries = Array.isArray(raw) ? raw : [];
  const rows: RmmvDbCatalogRow[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = Number(e.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const name = String(e.name ?? "") || `#${id}`;
    rows.push(buildRow(table, id, name, e));
  }
  return rows;
}

function buildDocumentRow(table: RmmvDbTableName, data: Record<string, unknown>): RmmvDbCatalogRow {
  switch (table) {
    case "system": {
      const gameTitle = String(data.gameTitle ?? "");
      const partyMembers = Array.isArray(data.partyMembers)
        ? (data.partyMembers as unknown[]).map((value) => Number(value)).filter(Number.isInteger)
        : [];
      return {
        id: 0,
        name: gameTitle || "System",
        gameTitle,
        switchCount: namedArrayCount(data.switches),
        variableCount: namedArrayCount(data.variables),
        startMapId: numberField(data.startMapId, 0),
        startX: numberField(data.startX, 0),
        startY: numberField(data.startY, 0),
        partyMembers,
      };
    }
    case "types":
      return {
        id: 0,
        name: "Types",
        elements: stringArray(data.elements),
        skillTypes: stringArray(data.skillTypes),
        weaponTypes: stringArray(data.weaponTypes),
        armorTypes: stringArray(data.armorTypes),
        equipTypes: stringArray(data.equipTypes),
      };
    case "terms": {
      const terms = data.terms && typeof data.terms === "object" && !Array.isArray(data.terms)
        ? data.terms as Record<string, unknown>
        : data;
      return {
        id: 0,
        name: "Terms",
        basicCount: arrayCount(terms.basic),
        paramsCount: arrayCount(terms.params),
        commandsCount: arrayCount(terms.commands),
        messageCount: terms.messages && typeof terms.messages === "object" && !Array.isArray(terms.messages)
          ? Object.keys(terms.messages).length
          : 0,
      };
    }
    default:
      throw new Error(`Table ${table} is not a document table`);
  }
}

function buildRow(table: RmmvDbTableName, id: number, name: string, e: Record<string, unknown>): RmmvDbCatalogRow {
  switch (table) {
    case "actors":
      return {
        id,
        name,
        classId: numberField(e.classId, 0),
        initialLevel: numberField(e.initialLevel, 1),
        nickname: stringFieldOrNull(e.nickname),
      };
    case "classes": {
      const expParams = Array.isArray(e.expParams) ? (e.expParams as unknown[]) : null;
      const expForLevel99 = expParams && expParams.length >= 1 ? numberOrNull(expParams[0]) : null;
      return { id, name, expForLevel99 };
    }
    case "skills":
      return {
        id,
        name,
        iconIndex: numberField(e.iconIndex, 0),
        mpCost: numberField(e.mpCost, 0),
        tpCost: numberField(e.tpCost, 0),
        scope: numberField(e.scope, 0),
        occasion: numberField(e.occasion, 0),
        description: stringFieldOrNull(e.description),
      };
    case "items":
      return {
        id,
        name,
        iconIndex: numberField(e.iconIndex, 0),
        price: numberField(e.price, 0),
        consumable: e.consumable !== false,
        scope: numberField(e.scope, 0),
        occasion: numberField(e.occasion, 0),
        description: stringFieldOrNull(e.description),
      };
    case "weapons":
      return {
        id,
        name,
        iconIndex: numberField(e.iconIndex, 0),
        price: numberField(e.price, 0),
        wtypeId: numberField(e.wtypeId, 0),
        description: stringFieldOrNull(e.description),
      };
    case "armors":
      return {
        id,
        name,
        iconIndex: numberField(e.iconIndex, 0),
        price: numberField(e.price, 0),
        atypeId: numberField(e.atypeId, 0),
        etypeId: numberField(e.etypeId, 0),
        description: stringFieldOrNull(e.description),
      };
    case "states":
      return {
        id,
        name,
        iconIndex: numberField(e.iconIndex, 0),
        restriction: numberField(e.restriction, 0),
        removeAtBattleEnd: Boolean(e.removeAtBattleEnd),
        removeByDamage: Boolean(e.removeByDamage),
        description: stringFieldOrNull(e.message1) ?? stringFieldOrNull(e.message2) ?? null,
      };
    case "enemies":
      return {
        id,
        name,
        exp: numberField(e.exp, 0),
        gold: numberField(e.gold, 0),
        battlerName: stringFieldOrNull(e.battlerName),
      };
    case "troops": {
      const members = Array.isArray(e.members) ? (e.members as unknown[]).filter(Boolean) : [];
      return { id, name, memberCount: members.length };
    }
    case "tilesets": {
      const tilesetNames = Array.isArray(e.tilesetNames)
        ? (e.tilesetNames as unknown[]).map((value) => String(value ?? ""))
        : [];
      return {
        id,
        name,
        mode: numberField(e.mode, 1),
        tilesetNames,
      };
    }
    case "animations":
      return {
        id,
        name,
        animation1Name: stringFieldOrNull(e.animation1Name),
        animation2Name: stringFieldOrNull(e.animation2Name),
      };
    case "commonEvents":
      return {
        id,
        name,
        trigger: numberField(e.trigger, 0),
        switchId: numberField(e.switchId, 0),
      };
    default:
      throw new Error(`Table ${table} is not a row table`);
  }
}

function numberField(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringFieldOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")) : [];
}

function arrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function namedArrayCount(value: unknown): number {
  return Array.isArray(value) ? value.filter((item, index) => index > 0 && typeof item === "string" && item.trim()).length : 0;
}
