import assert from 'node:assert/strict';
import test from 'node:test';

import type { GameReleaseGameIndex } from '../../../../contract/game-release.ts';
import {
  createGameManifestSigningIdentity,
  signGameReleaseManifest,
  validateGameManifestSignatureConfig,
  verifyGameReleaseManifestSignature,
} from './game-manifest-signing-service.ts';

test('creates a P-256 identity and rejects a mismatched private key', () => {
  const identity = createGameManifestSigningIdentity('manifest-signing-test');
  const other = createGameManifestSigningIdentity('manifest-signing-other');
  const config = validateGameManifestSignatureConfig({
    enabled: true,
    algorithm: identity.algorithm,
    keyId: identity.keyId,
    publicKey: identity.publicKey,
  });
  assert.equal(config.keyId, identity.keyId);
  assert.throws(
    () => signGameReleaseManifest('sample-game', gameEntry(), config, other.privateKey),
    /does not match/,
  );
});

test('signs only one game entry and detects release manifest tampering', () => {
  const identity = createGameManifestSigningIdentity('manifest-signing-test');
  const config = {
    enabled: true,
    algorithm: identity.algorithm,
    keyId: identity.keyId,
    publicKey: identity.publicKey,
  };
  const game = gameEntry();
  game.signature = signGameReleaseManifest('sample-game', game, config, identity.privateKey);
  assert.equal(verifyGameReleaseManifestSignature('sample-game', game, config), true);
  game.channels.stable.latestReleaseId = 'tampered-release';
  assert.equal(verifyGameReleaseManifestSignature('sample-game', game, config), false);
});

function gameEntry(): GameReleaseGameIndex {
  return {
    channels: {
      stable: {
        latestReleaseId: 'release-one',
        latestReleaseIds: {},
        maintenance: null,
        releases: [],
      },
    },
  };
}
