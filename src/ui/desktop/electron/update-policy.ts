import { load as loadYaml } from 'js-yaml';

export const SECURE_GITHUB_UPDATE_SOURCE = {
  provider: 'github' as const,
  owner: 'Lunaroa',
  repo: 'RPG-Agent-MV',
};

export interface SecureUpdateConfig {
  provider: 'github';
  owner: string;
  repo: string;
  publisherNames: string[];
}

export interface UpdateInfoLike {
  version?: unknown;
}

export interface UpdateChecker {
  once(event: 'update-available' | 'update-not-available', listener: (info: UpdateInfoLike) => void): unknown;
  removeListener(event: 'update-available' | 'update-not-available', listener: (info: UpdateInfoLike) => void): unknown;
  checkForUpdates(): Promise<unknown>;
}

export type UpdateAvailability =
  | { status: 'update-available'; version: string }
  | { status: 'up-to-date' };

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The packaged update configuration must be a YAML object.');
  }
  return value as Record<string, unknown>;
}

function normalizePublisherNames(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const names = values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!names.length || names.length !== values.length) {
    throw new Error('The packaged update configuration must contain a non-empty publisherName.');
  }
  return names;
}

export function validateSecureUpdateConfig(value: unknown): SecureUpdateConfig {
  const config = requireRecord(value);
  if (config.provider !== SECURE_GITHUB_UPDATE_SOURCE.provider) {
    throw new Error('Only the official GitHub update provider is allowed.');
  }
  if (
    config.owner !== SECURE_GITHUB_UPDATE_SOURCE.owner
    || config.repo !== SECURE_GITHUB_UPDATE_SOURCE.repo
  ) {
    throw new Error('The packaged update repository does not match the official product repository.');
  }
  return {
    ...SECURE_GITHUB_UPDATE_SOURCE,
    publisherNames: normalizePublisherNames(config.publisherName),
  };
}

export function parseSecureUpdateConfigYaml(raw: string): SecureUpdateConfig {
  return validateSecureUpdateConfig(loadYaml(raw));
}

export async function checkUpdaterAvailability(checker: UpdateChecker): Promise<UpdateAvailability> {
  let outcome: UpdateAvailability | null = null;
  let outcomeError: Error | null = null;

  const onAvailable = (info: UpdateInfoLike) => {
    const version = typeof info.version === 'string' ? info.version.trim() : '';
    if (!version) {
      outcomeError = new Error('The update provider reported an available update without a version.');
      return;
    }
    outcome = { status: 'update-available', version };
  };
  const onNotAvailable = () => {
    outcome = { status: 'up-to-date' };
  };

  checker.once('update-available', onAvailable);
  checker.once('update-not-available', onNotAvailable);
  try {
    await checker.checkForUpdates();
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (outcomeError) throw outcomeError;
    if (!outcome) {
      throw new Error('The update check completed without reporting an availability result.');
    }
    return outcome;
  } finally {
    checker.removeListener('update-available', onAvailable);
    checker.removeListener('update-not-available', onNotAvailable);
  }
}
