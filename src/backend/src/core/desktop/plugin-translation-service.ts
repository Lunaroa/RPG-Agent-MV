import crypto from 'node:crypto';
import path from 'node:path';

import type {
  PluginParameterSchemaField,
  PluginTranslationParamText,
  PluginTranslationPayload,
  PluginTranslationRecord,
} from '../../../../contract/types.ts';

import { getDatabase } from '../db/pool.ts';
import * as providerRegistry from '../llm/provider-registry.ts';
import { normalizeApiKey } from '../llm/list-models-resolve.ts';
import * as openaiClient from '../llm/client/openai-compatible.ts';
import * as anthropicClient from '../llm/client/anthropic.ts';
import { readPluginConfiguration } from './plugin-management-service.ts';

/** Source texts extracted from a plugin header; the unit the LLM translates in one call. */
export interface PluginTranslationSource {
  plugindesc: string;
  help: string;
  params: Record<string, PluginTranslationParamText>;
}

/** Provider binding used for the lightweight side-query (same shape as the agent execution binding). */
export interface PluginTranslationModelRef {
  providerId: string;
  modelId: string;
}

const TRANSLATION_TIMEOUT_MS = 180_000;
const TRANSLATION_MAX_TOKENS = 8_192;

export function buildPluginTranslationSource(
  workflowRoot: string,
  project: string,
  pluginName: string,
): PluginTranslationSource {
  const config = readPluginConfiguration(workflowRoot, project);
  const managed = config.plugins.find((plugin) => plugin.name === pluginName);
  const header = managed?.header
    || config.pluginFiles.find((file) => file.name === pluginName)?.header;
  if (!header) throw new Error(`Plugin not found: ${pluginName}`);
  const params: Record<string, PluginTranslationParamText> = {};
  collectParamTexts(managed?.parameterSchema?.fields || [], '', params);
  return { plugindesc: header.plugindesc, help: header.help, params };
}

function collectParamTexts(
  fields: PluginParameterSchemaField[],
  prefix: string,
  out: Record<string, PluginTranslationParamText>,
): void {
  for (const field of fields) {
    const key = prefix ? `${prefix}.${field.key}` : field.key;
    out[key] = { label: field.label || field.key, description: field.description || '' };
    if (field.fields) collectParamTexts(field.fields, key, out);
    if (field.item?.fields) collectParamTexts(field.item.fields, `${key}[]`, out);
  }
}

export function computePluginTranslationSourceHash(source: PluginTranslationSource): string {
  return crypto.createHash('sha1').update(JSON.stringify(source)).digest('hex');
}

export function getPluginTranslation(
  workflowRoot: string,
  project: string,
  pluginName: string,
  lang: string,
): PluginTranslationRecord | null {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT source_hash, payload, updated_at FROM plugin_translations WHERE project = ? AND plugin_name = ? AND lang = ?',
  ).get(path.resolve(project), pluginName, lang) as
    | { source_hash: string; payload: string; updated_at: string }
    | undefined;
  if (!row) return null;
  const payload = parseStoredTranslationPayload(row.payload, pluginName, lang);
  const currentHash = computePluginTranslationSourceHash(
    buildPluginTranslationSource(workflowRoot, project, pluginName),
  );
  return {
    pluginName,
    lang,
    sourceHash: row.source_hash,
    stale: row.source_hash !== currentHash,
    payload,
    updatedAt: row.updated_at,
  };
}

export function storePluginTranslation(
  project: string,
  pluginName: string,
  lang: string,
  sourceHash: string,
  payload: PluginTranslationPayload,
): PluginTranslationRecord {
  const db = getDatabase();
  const updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO plugin_translations (project, plugin_name, lang, source_hash, payload, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project, plugin_name, lang) DO UPDATE SET
      source_hash = excluded.source_hash,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `).run(path.resolve(project), pluginName, lang, sourceHash, JSON.stringify(payload), updatedAt);
  return { pluginName, lang, sourceHash, stale: false, payload, updatedAt };
}

export async function translatePluginDocumentation(
  workflowRoot: string,
  project: string,
  pluginName: string,
  lang: string,
  model: PluginTranslationModelRef,
): Promise<PluginTranslationRecord> {
  const source = buildPluginTranslationSource(workflowRoot, project, pluginName);
  const sourceHash = computePluginTranslationSourceHash(source);
  const prompt = buildPluginTranslationPrompt(source, lang);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);
  let responseText: string;
  try {
    responseText = await runTranslationModel(workflowRoot, model, prompt, controller.signal);
  } finally {
    clearTimeout(timer);
  }
  const payload = parsePluginTranslationResponse(responseText, source);
  return storePluginTranslation(project, pluginName, lang, sourceHash, payload);
}

export function buildPluginTranslationPrompt(source: PluginTranslationSource, lang: string): string {
  return [
    'You are translating RPG Maker MV/MZ plugin documentation for an editor UI.',
    `Translate every "plugindesc", "help", "label" and "description" string value in the JSON below into the language with BCP-47 tag "${lang}".`,
    'Return a JSON object with exactly the same structure and the same keys.',
    'Do not translate JSON keys, parameter identifiers, code snippets, file paths, plugin command names, or RPG Maker escape codes (e.g. \\V[n], \\N[n], %1).',
    'Keep line breaks inside string values.',
    'Output the JSON object and nothing else — no prose, no explanation, no code fences.',
    '',
    JSON.stringify(source),
  ].join('\n');
}

/** Lightweight side-query on the bound provider — same channel as the memory recall query, no agent session. */
async function runTranslationModel(
  workflowRoot: string,
  model: PluginTranslationModelRef,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const doc = await providerRegistry.loadDocument(workflowRoot);
  const provider = doc.providers[model.providerId];
  if (!provider) throw new Error(`Translation provider not found: ${model.providerId}`);
  const baseUrl = provider.baseUrl;
  const apiKey = normalizeApiKey(provider.credentialValue || '');
  if (!baseUrl) throw new Error('Translation provider has no baseUrl configured.');
  if (!apiKey) throw new Error('Translation provider has no usable credential.');
  const messages = [{ role: 'user', content: prompt }];

  if (provider.protocol === 'anthropic') {
    const payload = await anthropicClient.chat({
      baseUrl, apiKey, model: model.modelId, messages, maxTokens: TRANSLATION_MAX_TOKENS, signal,
    });
    return anthropicClient.extractMessageText(payload);
  }
  const payload = await openaiClient.chat({
    baseUrl, apiKey, model: model.modelId, messages, maxTokens: TRANSLATION_MAX_TOKENS, signal,
  });
  const choices = (payload as Record<string, unknown>)?.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  return typeof message?.content === 'string' ? message.content : '';
}

export function parsePluginTranslationResponse(
  responseText: string,
  source: PluginTranslationSource,
): PluginTranslationPayload {
  const text = stripCodeFences(responseText).trim();
  if (!text) throw new Error('The translation model returned an empty response.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The translation model did not return valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The translation response is not a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  const paramsRaw = record.params;
  if (paramsRaw !== undefined && (typeof paramsRaw !== 'object' || paramsRaw === null || Array.isArray(paramsRaw))) {
    throw new Error('The translation response "params" field is not an object.');
  }
  const paramsRecord = (paramsRaw || {}) as Record<string, unknown>;
  const params: Record<string, PluginTranslationParamText> = {};
  const invalid: string[] = [];
  for (const key of Object.keys(source.params)) {
    const entry = paramsRecord[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      invalid.push(key);
      continue;
    }
    const { label, description } = entry as Record<string, unknown>;
    if (typeof label !== 'string' || typeof description !== 'string') {
      invalid.push(key);
      continue;
    }
    params[key] = { label, description };
  }
  if (invalid.length > 0) {
    throw new Error(`The translation response is missing or malformed for parameters: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '…' : ''}`);
  }
  if (typeof record.plugindesc !== 'string' || typeof record.help !== 'string') {
    throw new Error('The translation response is missing the "plugindesc" or "help" field.');
  }
  return {
    plugindesc: record.plugindesc,
    help: record.help,
    params,
  };
}

function parseStoredTranslationPayload(
  raw: string,
  pluginName: string,
  lang: string,
): PluginTranslationPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Stored translation for ${pluginName} (${lang}) is corrupted; re-run the translation.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Stored translation for ${pluginName} (${lang}) is corrupted; re-run the translation.`);
  }
  const record = parsed as Record<string, unknown>;
  const params = (record.params && typeof record.params === 'object' && !Array.isArray(record.params))
    ? record.params as Record<string, PluginTranslationParamText>
    : {};
  return {
    plugindesc: typeof record.plugindesc === 'string' ? record.plugindesc : '',
    help: typeof record.help === 'string' ? record.help : '',
    params,
  };
}

function stripCodeFences(text: string): string {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/^```[A-Za-z0-9_-]*\r?\n([\s\S]*?)\r?\n?```$/);
  return fenced ? fenced[1] : trimmed;
}
