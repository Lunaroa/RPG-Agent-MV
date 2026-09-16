import crypto from 'node:crypto';

import type {
  GameManifestSignatureConfig,
  GameManifestSigningIdentitySummary,
  GameReleaseGameIndex,
  GameReleaseManifestPayload,
  GameReleaseManifestSignature,
} from '../../../../contract/game-release.ts';

export const GAME_MANIFEST_SIGNATURE_ALGORITHM = 'ECDSA-P256-SHA256' as const;

export interface GameManifestSigningIdentity extends GameManifestSigningIdentitySummary {
  privateKey: string;
}

export function createGameManifestSigningIdentity(credentialId: string): GameManifestSigningIdentity {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(credentialId)) {
    throw new Error('The manifest signing credential id is invalid.');
  }
  const pair = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { format: 'der', type: 'spki' },
    privateKeyEncoding: { format: 'der', type: 'pkcs8' },
  });
  const publicKey = pair.publicKey.toString('base64');
  return {
    credentialId,
    algorithm: GAME_MANIFEST_SIGNATURE_ALGORITHM,
    keyId: keyIdForPublicKey(pair.publicKey),
    publicKey,
    privateKey: pair.privateKey.toString('base64'),
  };
}

export function validateGameManifestSignatureConfig(value: unknown): GameManifestSignatureConfig {
  if (!isRecord(value)) throw new Error('update.manifestSignature must be an object.');
  const allowed = new Set(['enabled', 'algorithm', 'keyId', 'publicKey']);
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length) throw new Error(`update.manifestSignature contains unsupported fields: ${unsupported.join(', ')}.`);
  if (typeof value.enabled !== 'boolean') throw new Error('update.manifestSignature.enabled must be true or false.');
  if (value.algorithm !== GAME_MANIFEST_SIGNATURE_ALGORITHM) {
    throw new Error(`update.manifestSignature.algorithm must be ${GAME_MANIFEST_SIGNATURE_ALGORITHM}.`);
  }
  if (typeof value.keyId !== 'string' || !/^[a-f0-9]{64}$/.test(value.keyId)) {
    throw new Error('update.manifestSignature.keyId must be a lowercase SHA-256 digest.');
  }
  if (typeof value.publicKey !== 'string' || !isStrictBase64(value.publicKey)) {
    throw new Error('update.manifestSignature.publicKey must be a base64 encoded P-256 public key.');
  }
  const publicKey = readPublicKey(value.publicKey);
  const exported = publicKey.export({ format: 'der', type: 'spki' });
  if (keyIdForPublicKey(exported) !== value.keyId) {
    throw new Error('update.manifestSignature.keyId does not match its public key.');
  }
  return {
    enabled: value.enabled,
    algorithm: GAME_MANIFEST_SIGNATURE_ALGORITHM,
    keyId: value.keyId,
    publicKey: exported.toString('base64'),
  };
}

export function gameReleaseManifestPayload(gameId: string, game: GameReleaseGameIndex): Buffer {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(gameId)) throw new Error('The signed game id is invalid.');
  if (!game || typeof game !== 'object' || !game.channels || typeof game.channels !== 'object') {
    throw new Error('The signed game release entry is invalid.');
  }
  const payload: GameReleaseManifestPayload = {
    schemaVersion: 1,
    gameId,
    channels: game.channels,
  };
  return Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function signGameReleaseManifest(
  gameId: string,
  game: GameReleaseGameIndex,
  configInput: GameManifestSignatureConfig,
  privateKeyEncoded: string,
): GameReleaseManifestSignature {
  const config = validateGameManifestSignatureConfig(configInput);
  if (!config.enabled) throw new Error('Manifest signing is not enabled.');
  if (!isStrictBase64(privateKeyEncoded)) throw new Error('The manifest signing private key is invalid.');
  let privateKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey({
      key: Buffer.from(privateKeyEncoded, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
  } catch (error) {
    throw new Error('The manifest signing private key could not be read.', { cause: error });
  }
  assertP256(privateKey);
  const derivedPublic = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  if (derivedPublic.toString('base64') !== config.publicKey || keyIdForPublicKey(derivedPublic) !== config.keyId) {
    throw new Error('The manifest signing private key does not match the public key embedded in this build.');
  }
  const payload = gameReleaseManifestPayload(gameId, game);
  const signature = crypto.sign('sha256', payload, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return {
    schemaVersion: 1,
    algorithm: GAME_MANIFEST_SIGNATURE_ALGORITHM,
    keyId: config.keyId,
    payloadSha256: crypto.createHash('sha256').update(payload).digest('hex'),
    value: signature.toString('base64'),
  };
}

export function verifyGameReleaseManifestSignature(
  gameId: string,
  game: GameReleaseGameIndex,
  configInput: GameManifestSignatureConfig,
): boolean {
  const config = validateGameManifestSignatureConfig(configInput);
  const signature = game.signature;
  if (!signature || signature.schemaVersion !== 1 || signature.algorithm !== config.algorithm
    || signature.keyId !== config.keyId || !/^[a-f0-9]{64}$/.test(signature.payloadSha256)
    || !isStrictBase64(signature.value)) return false;
  const payload = gameReleaseManifestPayload(gameId, game);
  if (crypto.createHash('sha256').update(payload).digest('hex') !== signature.payloadSha256) return false;
  const bytes = Buffer.from(signature.value, 'base64');
  if (bytes.byteLength !== 64) return false;
  return crypto.verify('sha256', payload, {
    key: readPublicKey(config.publicKey),
    dsaEncoding: 'ieee-p1363',
  }, bytes);
}

function readPublicKey(encoded: string): crypto.KeyObject {
  let key: crypto.KeyObject;
  try {
    key = crypto.createPublicKey({ key: Buffer.from(encoded, 'base64'), format: 'der', type: 'spki' });
  } catch (error) {
    throw new Error('update.manifestSignature.publicKey could not be read.', { cause: error });
  }
  assertP256(key);
  return key;
}

function assertP256(key: crypto.KeyObject): void {
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('Manifest signing keys must use the P-256 elliptic curve.');
  }
}

function keyIdForPublicKey(publicKey: Buffer): string {
  return crypto.createHash('sha256').update(publicKey).digest('hex');
}

function isStrictBase64(value: string): boolean {
  if (!value || value.length > 16_384 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
