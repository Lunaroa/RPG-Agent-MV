import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { GameEncryptionKeySummary } from '../../../../contract/game-release.ts';
import { lunaRpgDirPath } from './project-config-service.ts';

interface StoredEncryptionKey {
  schemaVersion: 1;
  id: string;
  algorithm: 'AES-256-GCM';
  createdAt: string;
  keyBase64: string;
}

const KEY_DIRECTORY = 'release-keys';

export function listGameEncryptionKeys(project: string): GameEncryptionKeySummary[] {
  const directory = keyDirectory(project);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readGameEncryptionKey(project, entry.name.slice(0, -5)).summary)
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
}

export function generateGameEncryptionKey(project: string, id: string): GameEncryptionKeySummary {
  const normalizedId = requireKeyId(id);
  const file = keyFile(project, normalizedId);
  if (fs.existsSync(file)) throw new Error(`Encryption key already exists: ${normalizedId}.`);
  return writeKey(project, normalizedId, crypto.randomBytes(32), new Date().toISOString());
}

export function importGameEncryptionKey(project: string, id: string, encodedKey: string): GameEncryptionKeySummary {
  const normalizedId = requireKeyId(id);
  const file = keyFile(project, normalizedId);
  if (fs.existsSync(file)) throw new Error(`Encryption key already exists: ${normalizedId}.`);
  const source = String(encodedKey || '').trim();
  let key: Buffer;
  if (/^[a-f0-9]{64}$/i.test(source)) key = Buffer.from(source, 'hex');
  else {
    try {
      key = Buffer.from(source, 'base64');
    } catch {
      throw new Error('Imported encryption key must be 32 bytes encoded as hexadecimal or Base64.');
    }
  }
  if (key.byteLength !== 32) throw new Error('Imported encryption key must decode to exactly 32 bytes.');
  return writeKey(project, normalizedId, key, new Date().toISOString());
}

export function readGameEncryptionKey(project: string, id: string): {
  key: Buffer;
  summary: GameEncryptionKeySummary;
} {
  const normalizedId = requireKeyId(id);
  const file = keyFile(project, normalizedId);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Encryption key does not exist: ${normalizedId}.`);
  }
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredEncryptionKey;
  if (!value || value.schemaVersion !== 1 || value.id !== normalizedId || value.algorithm !== 'AES-256-GCM'
    || typeof value.createdAt !== 'string' || typeof value.keyBase64 !== 'string') {
    throw new Error(`Encryption key file is invalid: ${normalizedId}.`);
  }
  const key = Buffer.from(value.keyBase64, 'base64');
  if (key.byteLength !== 32) throw new Error(`Encryption key must contain exactly 32 bytes: ${normalizedId}.`);
  return {
    key,
    summary: {
      id: normalizedId,
      algorithm: 'AES-256-GCM',
      createdAt: value.createdAt,
      sha256: crypto.createHash('sha256').update(key).digest('hex'),
    },
  };
}

function writeKey(project: string, id: string, key: Buffer, createdAt: string): GameEncryptionKeySummary {
  const value: StoredEncryptionKey = {
    schemaVersion: 1,
    id,
    algorithm: 'AES-256-GCM',
    createdAt,
    keyBase64: key.toString('base64'),
  };
  const file = keyFile(project, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
    try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs are managed by the host. */ }
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
  return {
    id,
    algorithm: 'AES-256-GCM',
    createdAt,
    sha256: crypto.createHash('sha256').update(key).digest('hex'),
  };
}

function keyDirectory(project: string): string {
  return path.join(lunaRpgDirPath(project), KEY_DIRECTORY);
}

function keyFile(project: string, id: string): string {
  return path.join(keyDirectory(project), `${requireKeyId(id)}.json`);
}

function requireKeyId(value: string): string {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/.test(id)) {
    throw new Error('Encryption key id must contain only ASCII letters, digits, dots, underscores, or hyphens.');
  }
  return id;
}
