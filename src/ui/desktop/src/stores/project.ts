import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { projects as projectsApi, type ProjectRegistrationResult, type ProjectRemovalResult } from '../api/client';
import type { ProjectInfo } from '@contract/types';
import { resolveStoredProjectPath, type ProjectInfoLike } from '../utils/workspaceSettings';
import { normalizeProductLanguage } from '../i18n/messages';
import { projectStoreText } from './projectStoreLocalization';
import { useSettingsStore } from './settings';
import { useWorkspaceStore } from './workspace';

export type { ProjectInfo } from '@contract/types';

export const useProjectStore = defineStore('project', () => {
  const projects = ref<ProjectInfo[]>([]);
  const currentProject = ref<string>('');
  const loaded = ref(false);
  const loading = ref(false);
  const switching = ref(false);
  const registering = ref(false);
  const removing = ref(false);
  const loadError = ref<string | null>(null);
  const switchError = ref<string | null>(null);
  const registerError = ref<string | null>(null);
  const removeError = ref<string | null>(null);
  const hasProjects = computed(() => projects.value.length > 0);
  const currentProjectInfo = computed(() => projects.value.find((item) => item.path === currentProject.value) || null);
  const text = (key: Parameters<typeof projectStoreText>[1], params?: Record<string, string | number>) =>
    projectStoreText(useSettingsStore().ui.language, key, params);

  async function load(options: { force?: boolean } = {}) {
    if (loaded.value && !options.force) return;
    loading.value = true;
    loadError.value = null;
    removeError.value = null;
    try {
      const list = await projectsApi.list();
      applyProjectList(list);
      loaded.value = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : text('loadFailed');
      loadError.value = message;
      currentProject.value = '';
      projects.value = [];
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function switchProject(projectPath: string): Promise<void> {
    const previous = currentProject.value;
    switchError.value = null;
    removeError.value = null;
    if (!projects.value.some((project) => project.path === projectPath)) {
      switchError.value = text('unknownProject', { project: projectPath });
      throw new Error(switchError.value);
    }
    if (projectPath === previous) return;
    switching.value = true;
    currentProject.value = projectPath;
    try {
      await useWorkspaceStore().setLastProject(projectPath);
    } catch (error) {
      currentProject.value = previous;
      switchError.value = error instanceof Error ? error.message : text('saveSelectionFailed');
      throw error;
    } finally {
      switching.value = false;
    }
  }

  async function clearCurrentProject(): Promise<void> {
    const previous = currentProject.value;
    const workspace = useWorkspaceStore();
    switchError.value = null;
    removeError.value = null;
    if (!previous && !workspace.settings.lastProjectPath) return;
    switching.value = true;
    currentProject.value = '';
    try {
      await workspace.clearLastProject();
    } catch (error) {
      currentProject.value = previous;
      switchError.value = error instanceof Error ? error.message : text('clearSelectionFailed');
      throw error;
    } finally {
      switching.value = false;
    }
  }

  async function refresh(): Promise<void> {
    loading.value = true;
    loadError.value = null;
    removeError.value = null;
    try {
      applyProjectList(await projectsApi.refresh());
      loaded.value = true;
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : text('refreshFailed');
    } finally {
      loading.value = false;
    }
  }

  async function addProject(projectPath: string): Promise<void> {
    const normalizedPath = projectPath.trim();
    if (!normalizedPath) {
      registerError.value = text('projectPathRequired');
      throw new Error(registerError.value);
    }
    removeError.value = null;
    await applyRegistration(() => projectsApi.add(normalizedPath));
  }

  async function browseAndAddProject(): Promise<boolean> {
    const result = await applyRegistration(() => projectsApi.browseAndAdd());
    return !result.canceled;
  }

  async function removeProject(projectPath: string): Promise<void> {
    const normalizedPath = projectPath.trim();
    if (!normalizedPath) {
      removeError.value = text('removeTargetRequired');
      throw new Error(removeError.value);
    }

    const workspace = useWorkspaceStore();
    const previousCurrent = currentProject.value;
    const previousStored = workspace.settings.lastProjectPath || '';
    const removedCurrent = previousCurrent === normalizedPath;
    const removedStored = previousStored === normalizedPath;

    removing.value = true;
    removeError.value = null;
    try {
      const result = await projectsApi.remove(normalizedPath);
      const shouldClearStoredProject = applyProjectRemoval(result, {
        previousCurrent,
        previousStored,
        removedCurrent,
        removedStored,
      });
      if (shouldClearStoredProject) {
        await workspace.clearLastProject();
      }
    } catch (error) {
      removeError.value = error instanceof Error ? error.message : text('removeFailed');
      throw error;
    } finally {
      removing.value = false;
    }
  }

  function shouldShowSelector(): boolean {
    return projects.value.length > 0;
  }

  function applyProjectList(list: ProjectInfo[]): void {
    const normalized = Array.isArray(list) ? list : [];
    projects.value = normalized;
    if (!normalized.length) {
      currentProject.value = '';
      return;
    }
    const workspace = useWorkspaceStore();
    const preferredProject = currentProject.value || workspace.settings.lastProjectPath;
    currentProject.value = preferredProject
      ? resolveStoredProjectPath(preferredProject, normalized as ProjectInfoLike[], normalizeProductLanguage(useSettingsStore().ui.language))
      : '';
  }

  function applyProjectRemoval(
    result: ProjectRemovalResult,
    options: {
      previousCurrent: string;
      previousStored: string;
      removedCurrent: boolean;
      removedStored: boolean;
    },
  ): boolean {
    const normalized = Array.isArray(result.projects) ? result.projects : [];
    projects.value = normalized;
    const currentStillExists = options.previousCurrent
      ? normalized.some((project) => project.path === options.previousCurrent)
      : true;
    if (options.removedCurrent || !currentStillExists) {
      currentProject.value = '';
    }
    return options.removedCurrent
      || options.removedStored
      || (!currentStillExists && options.previousStored === options.previousCurrent);
  }

  async function applyRegistration(
    register: () => Promise<ProjectRegistrationResult & { canceled?: boolean }>,
  ): Promise<ProjectRegistrationResult & { canceled?: boolean }> {
    registering.value = true;
    registerError.value = null;
    removeError.value = null;
    try {
      const result = await register();
      applyProjectList(result.projects);
      if (result.project?.path) {
        await switchProject(result.project.path);
      }
      return result;
    } catch (error) {
      registerError.value = error instanceof Error ? error.message : text('addFailed');
      throw error;
    } finally {
      registering.value = false;
    }
  }

  return {
    projects,
    currentProject,
    currentProjectInfo,
    loaded,
    loading,
    switching,
    registering,
    removing,
    loadError,
    switchError,
    registerError,
    removeError,
    hasProjects,
    load,
    refresh,
    addProject,
    browseAndAddProject,
    removeProject,
    switchProject,
    clearCurrentProject,
    shouldShowSelector,
  };
});
