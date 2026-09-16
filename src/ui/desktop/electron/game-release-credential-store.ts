import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  GameReleaseCredentialKind,
  GameReleaseCredentialStatus,
} from '../../../contract/game-release.ts';

export interface GameReleaseCredentialValue {
  username?: string;
  password?: string;
  token?: string;
  storePassword?: string;
  keyPassword?: string;
  privateKey?: string;
}

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface StoredCredentialEntry {
  kind: GameReleaseCredentialKind;
  encrypted: string;
}

interface StoredCredentialFile {
  schemaVersion: 1;
  entries: Record<string, StoredCredentialEntry>;
}

const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VALUE_KEYS = new Set(['username', 'password', 'token', 'storePassword', 'keyPassword', 'privateKey']);

export class GameReleaseCredentialStore {
  readonly file: string;

  constructor(
    userDataRoot: string,
    private readonly safeStorage: SafeStoragePort,
  ) {
    this.file = path.join(path.resolve(userDataRoot), 'runtime', 'secrets', 'game-release-credentials.json');
  }

  status(kind?: GameReleaseCredentialKind, credentialId?: string): GameReleaseCredentialStatus {
    const available = this.safeStorage.isEncryptionAvailable();
    if (!kind || !credentialId) return { available, exists: false };
    validateKind(kind);
    validateCredentialId(credentialId);
    if (!available) return { available: false, exists: false, kind, credentialId };
    const entry = this.readFile().entries[credentialId];
    return { available: true, exists: entry?.kind === kind, kind, credentialId };
  }

  read(kind: GameReleaseCredentialKind, credentialId: string): GameReleaseCredentialValue | null {
    validateKind(kind);
    validateCredentialId(credentialId);
    if (!this.safeStorage.isEncryptionAvailable()) return null;
    const entry = this.readFile().entries[credentialId];
    if (!entry || entry.kind !== kind) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.safeStorage.decryptString(Buffer.from(entry.encrypted, 'base64')));
    } catch (error) {
      throw new Error('The remembered release credential could not be decrypted. Forget it and enter the credential again.', { cause: error });
    }
    return validateCredentialValue(kind, parsed);
  }

  save(kind: GameReleaseCredentialKind, credentialId: string, value: GameReleaseCredentialValue): void {
    validateKind(kind);
    validateCredentialId(credentialId);
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('This computer does not provide secure credential encryption. Use the credential for this run without remembering it.');
    }
    const normalized = validateCredentialValue(kind, value);
    const data = this.readFile();
    data.entries[credentialId] = {
      kind,
      encrypted: this.safeStorage.encryptString(JSON.stringify(normalized)).toString('base64'),
    };
    writeJsonAtomically(this.file, data);
  }

  forget(kind: GameReleaseCredentialKind, credentialId: string): boolean {
    validateKind(kind);
    validateCredentialId(credentialId);
    const data = this.readFile();
    if (data.entries[credentialId]?.kind !== kind) return false;
    delete data.entries[credentialId];
    writeJsonAtomically(this.file, data);
    return true;
  }

  private readFile(): StoredCredentialFile {
    if (!fs.existsSync(this.file)) return { schemaVersion: 1, entries: {} };
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
    if (!isRecord(raw) || raw.schemaVersion !== 1 || !isRecord(raw.entries)) {
      throw new Error('The secure release credential index is invalid. Move it aside and enter credentials again.');
    }
    const entries: Record<string, StoredCredentialEntry> = {};
    for (const [id, value] of Object.entries(raw.entries)) {
      validateCredentialId(id);
      if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.encrypted !== 'string'
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.encrypted)) {
        throw new Error('The secure release credential index contains an invalid entry.');
      }
      validateKind(value.kind);
      entries[id] = { kind: value.kind, encrypted: value.encrypted };
    }
    return { schemaVersion: 1, entries };
  }
}

function validateCredentialValue(
  kind: GameReleaseCredentialKind,
  value: unknown,
): GameReleaseCredentialValue {
  if (!isRecord(value) || Object.keys(value).some((key) => !VALUE_KEYS.has(key))) {
    throw new Error('The release credential has an invalid shape.');
  }
  const result: GameReleaseCredentialValue = {};
  for (const key of VALUE_KEYS) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== 'string' || candidate.length > 16_384) {
      throw new Error(`The release credential field ${key} is invalid.`);
    }
    result[key as keyof GameReleaseCredentialValue] = candidate;
  }
  if (kind === 'android-signing') {
    if (!result.storePassword || !result.keyPassword || result.username || result.password || result.token || result.privateKey) {
      throw new Error('A remembered Android signing credential requires only the keystore password and key password.');
    }
  } else if (kind === 'upload') {
    const basic = Boolean(result.username && result.password !== undefined && !result.token);
    const bearer = Boolean(result.token && !result.username && result.password === undefined);
    if ((!basic && !bearer) || result.storePassword || result.keyPassword || result.privateKey) {
      throw new Error('A remembered upload credential must contain either Basic credentials or one Bearer token.');
    }
  } else if (!result.privateKey || result.username || result.password || result.token
    || result.storePassword || result.keyPassword) {
    throw new Error('A remembered manifest signing credential requires only its private key.');
  }
  return result;
}

function validateKind(value: string): asserts value is GameReleaseCredentialKind {
  if (value !== 'android-signing' && value !== 'upload' && value !== 'manifest-signing') {
    throw new Error('Unknown release credential kind.');
  }
}

function validateCredentialId(value: string): void {
  if (!CREDENTIAL_ID_PATTERN.test(value)) throw new Error('The release credential id is invalid.');
}

function writeJsonAtomically(file: string, value: unknown): void {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
