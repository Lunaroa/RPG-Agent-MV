import type { WorkspaceSettings } from '../../../contract/types.ts';
import { mergeWorkspaceSettings, normalizeWorkspaceSettings } from '../src/utils/workspaceSettings.ts';

export class WorkspaceSettingsSession {
  private memorySnapshot: WorkspaceSettings | null = null;

  constructor(private readonly memoryOnly: boolean) {}

  initialize(persisted: WorkspaceSettings): void {
    this.memorySnapshot = this.memoryOnly ? normalizeWorkspaceSettings(persisted) : null;
  }

  read(readPersisted: () => WorkspaceSettings): WorkspaceSettings {
    if (this.memoryOnly && this.memorySnapshot) return normalizeWorkspaceSettings(this.memorySnapshot);
    return normalizeWorkspaceSettings(readPersisted());
  }

  replace(next: WorkspaceSettings, writePersisted: (value: WorkspaceSettings) => void): WorkspaceSettings {
    const normalized = normalizeWorkspaceSettings(next);
    if (this.memoryOnly) this.memorySnapshot = normalized;
    else writePersisted(normalized);
    return normalized;
  }

  patch(
    patch: WorkspaceSettings,
    readPersisted: () => WorkspaceSettings,
    writePersisted: (value: WorkspaceSettings) => void,
  ): WorkspaceSettings {
    const merged = mergeWorkspaceSettings(this.read(readPersisted), patch);
    return this.replace(merged, writePersisted);
  }
}
