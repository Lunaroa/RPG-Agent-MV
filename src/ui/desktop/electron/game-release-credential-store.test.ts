import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GameReleaseCredentialStore, type SafeStoragePort } from './game-release-credential-store.ts';

class TestSafeStorage implements SafeStoragePort {
  constructor(private available = true) {}
  isEncryptionAvailable() { return this.available; }
  encryptString(value: string) { return Buffer.from(`sealed:${value}`, 'utf8'); }
  decryptString(value: Buffer) {
    const text = value.toString('utf8');
    if (!text.startsWith('sealed:')) throw new Error('invalid test ciphertext');
    return text.slice('sealed:'.length);
  }
}

test('stores only encrypted release credentials and resolves them by kind', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-credentials-'));
  try {
    const store = new GameReleaseCredentialStore(root, new TestSafeStorage());
    store.save('android-signing', 'signing-sample', { storePassword: 'store-secret', keyPassword: 'key-secret' });
    assert.deepEqual(store.status('android-signing', 'signing-sample'), {
      available: true,
      exists: true,
      kind: 'android-signing',
      credentialId: 'signing-sample',
    });
    assert.deepEqual(store.read('android-signing', 'signing-sample'), {
      storePassword: 'store-secret',
      keyPassword: 'key-secret',
    });
    const persisted = fs.readFileSync(store.file, 'utf8');
    assert.doesNotMatch(persisted, /store-secret|key-secret/);
    assert.equal(store.read('upload', 'signing-sample'), null);
    store.save('manifest-signing', 'manifest-sample', { privateKey: 'private-key-material' });
    assert.deepEqual(store.read('manifest-signing', 'manifest-sample'), { privateKey: 'private-key-material' });
    assert.doesNotMatch(fs.readFileSync(store.file, 'utf8'), /private-key-material/);
    assert.equal(store.forget('android-signing', 'signing-sample'), true);
    assert.equal(store.status('android-signing', 'signing-sample').exists, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed when operating-system credential encryption is unavailable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-credentials-'));
  try {
    const store = new GameReleaseCredentialStore(root, new TestSafeStorage(false));
    assert.deepEqual(store.status(), { available: false, exists: false });
    assert.throws(
      () => store.save('upload', 'upload-sample', { token: 'token' }),
      /does not provide secure credential encryption/,
    );
    assert.equal(fs.existsSync(store.file), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
