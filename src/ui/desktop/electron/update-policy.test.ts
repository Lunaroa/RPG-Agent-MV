import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';

import {
  checkUpdaterAvailability,
  parseSecureUpdateConfigYaml,
  validateSecureUpdateConfig,
  type UpdateChecker,
} from './update-policy.ts';

class FakeUpdateChecker extends EventEmitter implements UpdateChecker {
  private readonly runCheck: (checker: FakeUpdateChecker) => Promise<void>;

  constructor(runCheck: (checker: FakeUpdateChecker) => Promise<void>) {
    super();
    this.runCheck = runCheck;
  }

  async checkForUpdates(): Promise<unknown> {
    await this.runCheck(this);
    return {};
  }
}

describe('secure GitHub update configuration', () => {
  test('accepts only the signed public GitHub source', () => {
    assert.deepEqual(validateSecureUpdateConfig({
      provider: 'github',
      owner: 'Lunaroa',
      repo: 'RPG-Agent-MV',
      publisherName: ['Example Software Publisher'],
    }), {
      provider: 'github',
      owner: 'Lunaroa',
      repo: 'RPG-Agent-MV',
      publisherNames: ['Example Software Publisher'],
    });
  });

  test('parses the signed packaged YAML configuration', () => {
    assert.deepEqual(parseSecureUpdateConfigYaml([
      'provider: github',
      'owner: Lunaroa',
      'repo: RPG-Agent-MV',
      'publisherName: Example Software Publisher',
    ].join('\n')), {
      provider: 'github',
      owner: 'Lunaroa',
      repo: 'RPG-Agent-MV',
      publisherNames: ['Example Software Publisher'],
    });
  });

  test('rejects unsigned update configurations', () => {
    assert.throws(
      () => validateSecureUpdateConfig({
        provider: 'github',
        owner: 'Lunaroa',
        repo: 'RPG-Agent-MV',
      }),
      /publisherName/,
    );
  });

  test('rejects non-GitHub and unexpected repositories', () => {
    assert.throws(
      () => validateSecureUpdateConfig({
        provider: 'generic',
        url: 'https://updates.example.invalid/',
        publisherName: 'Example Software Publisher',
      }),
      /GitHub/,
    );
    assert.throws(
      () => validateSecureUpdateConfig({
        provider: 'github',
        owner: 'example',
        repo: 'different-product',
        publisherName: 'Example Software Publisher',
      }),
      /repository/,
    );
  });
});

describe('update availability', () => {
  test('uses the updater available event and preserves its version', async () => {
    const checker = new FakeUpdateChecker(async (target) => {
      target.emit('update-available', { version: '1.2.3' });
    });

    assert.deepEqual(await checkUpdaterAvailability(checker), {
      status: 'update-available',
      version: '1.2.3',
    });
  });

  test('uses the updater not-available event instead of comparing versions again', async () => {
    const checker = new FakeUpdateChecker(async (target) => {
      target.emit('update-not-available', { version: '1.2.3' });
    });

    assert.deepEqual(await checkUpdaterAvailability(checker), {
      status: 'up-to-date',
    });
  });

  test('removes temporary listeners after a failed check', async () => {
    const checker = new FakeUpdateChecker(async () => {
      throw new Error('network unavailable');
    });

    await assert.rejects(() => checkUpdaterAvailability(checker), /network unavailable/);
    assert.equal(checker.listenerCount('update-available'), 0);
    assert.equal(checker.listenerCount('update-not-available'), 0);
  });

  test('fails when the updater completes without an outcome event', async () => {
    const checker = new FakeUpdateChecker(async () => undefined);
    await assert.rejects(
      () => checkUpdaterAvailability(checker),
      /without reporting an availability result/,
    );
  });
});
