<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, FolderOpened, Plus } from '@element-plus/icons-vue'

import type {
  AndroidBuildConfig,
  AndroidToolchainStatus,
  GameBuildPreset,
  GameBuildPreflightResult,
  GameBuildResult,
  GameBuildTarget,
  GameContentCategory,
  GameContentProcessingMode,
  GameEncryptionKeySummary,
  GameReleaseConfig,
  GameReleasePublishResult,
  GameReleaseProjectSettings,
  GameReleaseStatus,
} from '@contract/game-release'
import { gameBuild, gameRelease } from '../api/client'
import { useI18n } from '../i18n'
import { useProjectStore } from '../stores/project'

const projectStore = useProjectStore()
const { t } = useI18n()
const loading = ref(false)
const checking = ref(false)
const building = ref(false)
const publishing = ref(false)
const installingAndroidToolchain = ref(false)
const creatingAndroidKeystore = ref(false)
const creatingManifestSigningIdentity = ref(false)
const error = ref('')
const releaseStatus = ref<GameReleaseStatus | null>(null)
const release = ref<GameReleaseConfig | null>(null)
const settings = ref<GameReleaseProjectSettings | null>(null)
const preflight = ref<GameBuildPreflightResult | null>(null)
const result = ref<GameBuildResult | null>(null)
const published = ref<GameReleasePublishResult | null>(null)
const encryptionKeys = ref<GameEncryptionKeySummary[]>([])
const androidToolchain = ref<AndroidToolchainStatus | null>(null)
const androidIconCandidates = ref<string[]>([])
const uploadUsername = ref('')
const uploadPassword = ref('')
const uploadToken = ref('')
const signingStorePassword = ref('')
const signingKeyPassword = ref('')
const secureCredentialStorageAvailable = ref(false)
const rememberSigningCredential = ref(false)
const rememberUploadCredential = ref(false)
const signingCredentialRemembered = ref(false)
const uploadCredentialRemembered = ref(false)
const manifestSigningCredentialRemembered = ref(false)
interface PublicationLocaleDraft {
  language: string
  title: string
  summary: string
  maintenance: string
}
const publicationDefaultLanguage = ref('zh-CN')
const publicationLocales = ref<PublicationLocaleDraft[]>([])
const publicationRequired = ref(false)

const targets: GameBuildTarget[] = ['web', 'windows', 'android']
const processingCategories: GameContentCategory[] = ['images', 'audio', 'video', 'data', 'javascript', 'ui']
const processingModes: GameContentProcessingMode[] = ['none', 'compress', 'obfuscate', 'encrypt']
const activePreset = computed(() => {
  if (!settings.value) return null
  return settings.value.presets.find((preset) => preset.id === settings.value?.selectedPresetId)
    || settings.value.presets[0]
    || null
})
const hasProject = computed(() => Boolean(projectStore.currentProject))
const publicationLanguageOptions = computed(() => publicationLocales.value
  .map((entry) => entry.language.trim())
  .filter((language, index, languages) => language && languages.indexOf(language) === index))

watch(() => projectStore.currentProject, () => void load(), { immediate: true })
watch(
  () => [
    activePreset.value?.id,
    activePreset.value?.android?.signingCredentialId,
    activePreset.value?.upload?.credentialId,
    activePreset.value?.upload?.authorization,
    settings.value?.manifestSigningCredentialId,
  ],
  () => void refreshCredentialStatus(),
)

async function load() {
  const project = projectStore.currentProject
  releaseStatus.value = null
  release.value = null
  settings.value = null
  preflight.value = null
  result.value = null
  published.value = null
  encryptionKeys.value = []
  androidToolchain.value = null
  androidIconCandidates.value = []
  error.value = ''
  if (!project) return
  loading.value = true
  try {
    const [nextRelease, nextSettings, nextKeys, nextToolchain, credentialCapability, nextIconCandidates] = await Promise.all([
      gameRelease.status(project),
      gameBuild.getSettings(project),
      gameBuild.listEncryptionKeys(project),
      gameBuild.getAndroidToolchain(project),
      gameBuild.getCredentialStatus(),
      gameBuild.listAndroidIconCandidates(project),
    ])
    if (projectStore.currentProject !== project) return
    releaseStatus.value = nextRelease
    release.value = structuredClone(nextRelease.config)
    settings.value = structuredClone(nextSettings)
    encryptionKeys.value = nextKeys
    androidToolchain.value = nextToolchain
    secureCredentialStorageAvailable.value = credentialCapability.available
    androidIconCandidates.value = nextIconCandidates
    resetPublicationDraft(nextRelease.config.gameId, nextRelease.config.update.defaultLanguage || 'zh-CN')
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
    if (projectStore.currentProject === project) loading.value = false
  }
}

function resetPublicationDraft(gameId: string, language: string) {
  publicationDefaultLanguage.value = language
  publicationLocales.value = [{ language, title: gameId, summary: '', maintenance: '' }]
  publicationRequired.value = false
}

function addPublicationLocale() {
  const existing = new Set(publicationLanguageOptions.value)
  const language = ['en-US', 'zh-CN', 'ja-JP'].find((candidate) => !existing.has(candidate)) || ''
  publicationLocales.value.push({ language, title: '', summary: '', maintenance: '' })
}

function removePublicationLocale(index: number) {
  if (publicationLocales.value.length <= 1) return
  const [removed] = publicationLocales.value.splice(index, 1)
  if (removed?.language.trim() === publicationDefaultLanguage.value.trim()) {
    publicationDefaultLanguage.value = publicationLocales.value[0]?.language.trim() || ''
  }
}

function updatePublicationLanguage(index: number, language: string) {
  const entry = publicationLocales.value[index]
  if (!entry) return
  const previous = entry.language.trim()
  entry.language = language
  if (publicationDefaultLanguage.value.trim() === previous) publicationDefaultLanguage.value = language.trim()
}

function selectPreset(id: string) {
  if (settings.value) settings.value.selectedPresetId = id
  preflight.value = null
  result.value = null
}

function addPreset() {
  if (!settings.value || !activePreset.value) return
  const copy = structuredClone(activePreset.value)
  copy.id = globalThis.crypto.randomUUID()
  copy.name = t('gamePackaging.newPreset')
  if (copy.android) delete copy.android.signingCredentialId
  if (copy.upload) delete copy.upload.credentialId
  settings.value.presets.push(copy)
  settings.value.selectedPresetId = copy.id
}

async function removePreset() {
  if (!settings.value || !activePreset.value || settings.value.presets.length <= 1) return
  try {
    await ElMessageBox.confirm(t('gamePackaging.deletePresetConfirm'), t('gamePackaging.deletePreset'), {
      type: 'warning',
      confirmButtonText: t('ui.delete'),
      cancelButtonText: t('ui.cancel'),
    })
  } catch {
    return
  }
  const index = settings.value.presets.findIndex((preset) => preset.id === activePreset.value?.id)
  settings.value.presets.splice(index, 1)
  settings.value.selectedPresetId = settings.value.presets[Math.max(0, index - 1)]?.id
}

function changeTarget(target: GameBuildTarget) {
  const preset = activePreset.value
  if (!preset) return
  preset.target = target
  preset.architecture = target === 'web' ? 'web' : target === 'windows' ? 'x64' : 'per-abi'
  if (target === 'android') preset.android ||= defaultAndroid()
  else delete preset.android
  preflight.value = null
}

function defaultAndroid(): AndroidBuildConfig {
  return {
    applicationId: 'com.example.game',
    displayName: release.value?.gameId || 'Game',
    versionCode: 1,
    orientation: 'landscape',
    minSdk: 23,
    targetSdk: 36,
    abis: ['arm64-v8a'],
    iconRelativePath: androidIconCandidates.value.length === 1 ? androidIconCandidates.value[0]! : '',
    signing: 'debug',
  }
}

async function installAndroidToolchain() {
  try {
    await ElMessageBox.confirm(
      t('gamePackaging.androidToolchainConsentDetail'),
      t('gamePackaging.androidToolchainConsentTitle'),
      {
        type: 'warning',
        confirmButtonText: t('gamePackaging.androidToolchainInstall'),
        cancelButtonText: t('ui.cancel'),
      },
    )
  } catch {
    return
  }
  installingAndroidToolchain.value = true
  error.value = ''
  try {
    androidToolchain.value = await gameBuild.installAndroidToolchain({ acceptAndroidSdkLicense: true })
    ElMessage.success(t('gamePackaging.androidToolchainInstalled'))
  } catch (cause) {
    error.value = errorText(cause)
    ElMessage.error(error.value)
  } finally {
    installingAndroidToolchain.value = false
  }
}

async function selectOutput() {
  const preset = activePreset.value
  if (!preset) return
  const selected = await gameBuild.selectOutputDirectory(preset.outputDirectory)
  if (selected) preset.outputDirectory = selected
}

function ensureUpload(enabled: boolean) {
  const preset = activePreset.value
  if (!preset) return
  if (enabled) {
    preset.upload ||= { enabled: true, adapter: 'webdav', baseUrl: '', authorization: 'none' }
    preset.upload.enabled = true
  } else if (preset.upload) {
    preset.upload.enabled = false
  } else {
    preset.upload = { enabled: false, adapter: 'webdav', baseUrl: '', authorization: 'none' }
  }
  ensureCredentialReferences()
}

function ensureCredentialReferences() {
  const preset = activePreset.value
  if (!preset) return
  if (preset.android?.signing === 'release' && !preset.android.signingCredentialId) {
    preset.android.signingCredentialId = `android-signing-${preset.id}`
  }
  if (preset.upload?.enabled && preset.upload.authorization !== 'none' && !preset.upload.credentialId) {
    preset.upload.credentialId = `upload-${preset.id}`
  }
}

async function refreshCredentialStatus() {
  const preset = activePreset.value
  try {
    const capability = await gameBuild.getCredentialStatus()
    secureCredentialStorageAvailable.value = capability.available
    const [signing, upload, manifestSigning] = await Promise.all([
      preset?.android?.signingCredentialId
        ? gameBuild.getCredentialStatus('android-signing', preset.android.signingCredentialId)
        : Promise.resolve(null),
      preset?.upload?.credentialId
        ? gameBuild.getCredentialStatus('upload', preset.upload.credentialId)
        : Promise.resolve(null),
      settings.value?.manifestSigningCredentialId
        ? gameBuild.getCredentialStatus('manifest-signing', settings.value.manifestSigningCredentialId)
        : Promise.resolve(null),
    ])
    signingCredentialRemembered.value = Boolean(signing?.exists)
    uploadCredentialRemembered.value = Boolean(upload?.exists)
    manifestSigningCredentialRemembered.value = Boolean(manifestSigning?.exists)
  } catch {
    secureCredentialStorageAvailable.value = false
    signingCredentialRemembered.value = false
    uploadCredentialRemembered.value = false
    manifestSigningCredentialRemembered.value = false
  }
}

async function forgetCredential(kind: 'android-signing' | 'upload' | 'manifest-signing') {
  const preset = activePreset.value
  const id = kind === 'android-signing'
    ? preset?.android?.signingCredentialId
    : kind === 'upload'
      ? preset?.upload?.credentialId
      : settings.value?.manifestSigningCredentialId
  if (!id) return
  await gameBuild.forgetCredential(kind, id)
  if (kind === 'android-signing') {
    rememberSigningCredential.value = false
    signingCredentialRemembered.value = false
  } else if (kind === 'upload') {
    rememberUploadCredential.value = false
    uploadCredentialRemembered.value = false
  } else {
    manifestSigningCredentialRemembered.value = false
  }
  ElMessage.success(t('gamePackaging.credentialForgotten'))
}

async function setManifestSigning(enabled: boolean) {
  if (!release.value) return
  if (!enabled) {
    if (release.value.update.manifestSignature) release.value.update.manifestSignature.enabled = false
    return
  }
  if (release.value.update.manifestSignature) {
    release.value.update.manifestSignature.enabled = true
    return
  }
  await createManifestSigningIdentity()
}

async function createManifestSigningIdentity() {
  if (!release.value || !settings.value) return
  if (!release.value.update.enabled) {
    ElMessage.error(t('gamePackaging.enableUpdatesBeforeSigning'))
    return
  }
  if (!secureCredentialStorageAvailable.value) {
    ElMessage.error(t('gamePackaging.secureStorageUnavailable'))
    return
  }
  try {
    await ElMessageBox.confirm(
      t('gamePackaging.manifestSigningCreateWarning'),
      t('gamePackaging.manifestSigningCreate'),
      {
        type: 'warning',
        confirmButtonText: t('gamePackaging.manifestSigningCreate'),
        cancelButtonText: t('ui.cancel'),
      },
    )
  } catch {
    return
  }
  creatingManifestSigningIdentity.value = true
  try {
    const identity = await gameBuild.createManifestSigningIdentity()
    settings.value.manifestSigningCredentialId = identity.credentialId
    release.value.update.manifestSignature = {
      enabled: true,
      algorithm: identity.algorithm,
      keyId: identity.keyId,
      publicKey: identity.publicKey,
    }
    manifestSigningCredentialRemembered.value = true
    ElMessage.success(t('gamePackaging.manifestSigningCreated'))
  } catch (cause) {
    ElMessage.error(errorText(cause))
  } finally {
    creatingManifestSigningIdentity.value = false
  }
}

async function createAndroidKeystore() {
  const project = projectStore.currentProject
  const android = activePreset.value?.android
  if (!project || !android) return
  ensureCredentialReferences()
  if (!android.keyAlias?.trim() || !signingStorePassword.value || !signingKeyPassword.value) {
    ElMessage.error(t('gamePackaging.keystoreFieldsRequired'))
    return
  }
  try {
    await ElMessageBox.confirm(
      t('gamePackaging.createKeystoreWarning'),
      t('gamePackaging.createKeystore'),
      { type: 'warning', confirmButtonText: t('gamePackaging.createKeystore'), cancelButtonText: t('ui.cancel') },
    )
  } catch {
    return
  }
  creatingAndroidKeystore.value = true
  try {
    const created = await gameBuild.createAndroidKeystore({
      alias: android.keyAlias.trim(),
      storePassword: signingStorePassword.value,
      keyPassword: signingKeyPassword.value,
      commonName: android.displayName.trim() || release.value?.gameId || 'Game',
    }, project)
    if (!created) return
    android.keystorePath = created.path
    android.keyAlias = created.alias
    ElMessage.success(t('gamePackaging.keystoreCreated'))
  } catch (cause) {
    ElMessage.error(errorText(cause))
  } finally {
    creatingAndroidKeystore.value = false
  }
}

function processingChanged() {
  const preset = activePreset.value
  if (!preset) return
  const encrypted = processingCategories.some((category) => preset.processing[category] === 'encrypt')
  if (encrypted && !preset.processing.encryptionKeyId && encryptionKeys.value[0]) {
    preset.processing.encryptionKeyId = encryptionKeys.value[0].id
  }
  if (!encrypted) delete preset.processing.encryptionKeyId
  preflight.value = null
}

async function generateEncryptionKey() {
  const project = projectStore.currentProject
  if (!project) return
  try {
    const { value } = await ElMessageBox.prompt(
      t('gamePackaging.encryptionKeyNamePrompt'),
      t('gamePackaging.generateEncryptionKey'),
      { inputPattern: /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/, inputErrorMessage: t('gamePackaging.invalidKeyName') },
    )
    const key = await gameBuild.generateEncryptionKey(value, project)
    encryptionKeys.value = await gameBuild.listEncryptionKeys(project)
    if (activePreset.value) activePreset.value.processing.encryptionKeyId = key.id
    ElMessage.success(t('gamePackaging.encryptionKeyCreated'))
  } catch (cause) {
    if (cause !== 'cancel' && cause !== 'close') ElMessage.error(errorText(cause))
  }
}

async function importEncryptionKey() {
  const project = projectStore.currentProject
  if (!project) return
  try {
    const name = await ElMessageBox.prompt(
      t('gamePackaging.encryptionKeyNamePrompt'),
      t('gamePackaging.importEncryptionKey'),
      { inputPattern: /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/, inputErrorMessage: t('gamePackaging.invalidKeyName') },
    )
    const material = await ElMessageBox.prompt(
      t('gamePackaging.encryptionKeyMaterialPrompt'),
      t('gamePackaging.importEncryptionKey'),
      { inputType: 'password' },
    )
    const key = await gameBuild.importEncryptionKey(name.value, material.value, project)
    encryptionKeys.value = await gameBuild.listEncryptionKeys(project)
    if (activePreset.value) activePreset.value.processing.encryptionKeyId = key.id
    ElMessage.success(t('gamePackaging.encryptionKeyImported'))
  } catch (cause) {
    if (cause !== 'cancel' && cause !== 'close') ElMessage.error(errorText(cause))
  }
}

async function persistSettings(): Promise<void> {
  const project = projectStore.currentProject
  if (!project || !settings.value) throw new Error(t('gamePackaging.noProject'))
  ensureCredentialReferences()
  settings.value = await gameBuild.saveSettings(structuredClone(settings.value), project)
}

async function runPreflight(): Promise<GameBuildPreflightResult | null> {
  const project = projectStore.currentProject
  const preset = activePreset.value
  if (!project || !preset || !release.value) return null
  checking.value = true
  error.value = ''
  result.value = null
  try {
    await persistSettings()
    const checked = await gameBuild.preflight({
      presetId: preset.id,
      releaseConfig: structuredClone(release.value),
    }, project)
    if (projectStore.currentProject !== project) return null
    preflight.value = checked
    if (checked.ok) ElMessage.success(t('gamePackaging.checkPassed'))
    return checked
  } catch (cause) {
    error.value = errorText(cause)
    ElMessage.error(error.value)
    return null
  } finally {
    if (projectStore.currentProject === project) checking.value = false
  }
}

async function build() {
  const project = projectStore.currentProject
  const preset = activePreset.value
  if (!project || !preset || !release.value || !releaseStatus.value) return
  const checked = await runPreflight()
  if (!checked || !checked.ok) return
  if (checked.managedChanges.length) {
    try {
      await ElMessageBox.confirm(
        checked.managedChanges.map((change) => change.relativePath).join('\n'),
        t('gamePackaging.managedChangesTitle'),
        { type: 'warning', confirmButtonText: t('gamePackaging.continueBuild'), cancelButtonText: t('ui.cancel') },
      )
    } catch {
      return
    }
  }
  const conflict = await chooseConflict(checked)
  if (!conflict) return
  building.value = true
  error.value = ''
  published.value = null
  try {
    const built = await gameBuild.build({
      presetId: preset.id,
      outputConflict: conflict,
      releaseConfig: structuredClone(release.value),
      releaseExpectedSourceHash: releaseStatus.value.sourceHash,
      confirmManagedChanges: true,
      ...(preset.android?.signing === 'release' ? {
        signingCredential: {
          ...(signingStorePassword.value ? { storePassword: signingStorePassword.value } : {}),
          ...(signingKeyPassword.value ? { keyPassword: signingKeyPassword.value } : {}),
        },
        rememberSigningCredential: rememberSigningCredential.value,
      } : {}),
    }, project)
    result.value = built
    if (built.status === 'success') {
      ElMessage.success(t('gamePackaging.buildSucceeded'))
      const nextStatus = await gameRelease.status(project)
      releaseStatus.value = nextStatus
      release.value = structuredClone(nextStatus.config)
      settings.value = structuredClone(await gameBuild.getSettings(project))
      signingStorePassword.value = ''
      signingKeyPassword.value = ''
      await refreshCredentialStatus()
      if (preset.upload?.enabled && built.releaseId) await publishRelease(built.releaseId)
    } else if (built.status === 'failed') {
      error.value = built.error || t('gamePackaging.buildFailed')
      ElMessage.error(error.value)
    }
  } catch (cause) {
    error.value = errorText(cause)
    ElMessage.error(error.value)
  } finally {
    building.value = false
  }
}

async function selectPublicationDirectory() {
  if (!settings.value) return
  const selected = await gameBuild.selectOutputDirectory(settings.value.publicationDirectory)
  if (selected) settings.value.publicationDirectory = selected
}

async function publishRelease(releaseId = result.value?.releaseId) {
  const project = projectStore.currentProject
  const preset = activePreset.value
  const publicationDirectory = settings.value?.publicationDirectory
  if (!project || !preset || !releaseId || !publicationDirectory) return
  const title: Record<string, string> = {}
  const summary: Record<string, string> = {}
  const maintenance: Record<string, string> = {}
  for (const entry of publicationLocales.value) {
    const language = entry.language.trim()
    if (!language || !entry.title.trim() || !entry.summary.trim()) {
      error.value = t('gamePackaging.publicationMetadataRequired')
      ElMessage.error(error.value)
      return
    }
    if (title[language] !== undefined) {
      error.value = t('gamePackaging.publicationDuplicateLanguage')
      ElMessage.error(error.value)
      return
    }
    title[language] = entry.title.trim()
    summary[language] = entry.summary.trim()
    if (entry.maintenance.trim()) maintenance[language] = entry.maintenance.trim()
  }
  const defaultLanguage = publicationDefaultLanguage.value.trim()
  if (!defaultLanguage || title[defaultLanguage] === undefined) {
    error.value = t('gamePackaging.publicationDefaultLanguageMissing')
    ElMessage.error(error.value)
    return
  }
  if (!Object.keys(title).length) {
    error.value = t('gamePackaging.publicationMetadataRequired')
    ElMessage.error(error.value)
    return
  }
  publishing.value = true
  error.value = ''
  try {
    await persistSettings()
    published.value = await gameBuild.publish({
      releaseId,
      publishDirectory: publicationDirectory,
      metadata: {
        defaultLanguage,
        title,
        summary,
        required: publicationRequired.value,
        maintenance: Object.keys(maintenance).length ? maintenance : null,
      },
      updateLatest: true,
      ...(preset.upload?.enabled ? {
        upload: structuredClone(preset.upload),
        uploadCredential: {
          ...(uploadUsername.value ? { username: uploadUsername.value } : {}),
          ...(uploadPassword.value ? { password: uploadPassword.value } : {}),
          ...(uploadToken.value ? { token: uploadToken.value } : {}),
        },
        rememberUploadCredential: rememberUploadCredential.value,
      } : {}),
    }, project)
    ElMessage.success(preset.upload?.enabled ? t('gamePackaging.uploadSucceeded') : t('gamePackaging.publishSucceeded'))
    uploadPassword.value = ''
    uploadToken.value = ''
    await refreshCredentialStatus()
  } catch (cause) {
    error.value = errorText(cause)
    ElMessage.error(error.value)
  } finally {
    publishing.value = false
  }
}

async function chooseConflict(checked: GameBuildPreflightResult): Promise<'overwrite' | 'new-directory' | 'cancel' | null> {
  if (!checked.existingOutput) return 'overwrite'
  try {
    await ElMessageBox.confirm(t('gamePackaging.outputExistsDetail'), t('gamePackaging.outputExists'), {
      type: 'warning',
      distinguishCancelAndClose: true,
      confirmButtonText: t('gamePackaging.overwrite'),
      cancelButtonText: t('gamePackaging.newDirectory'),
    })
    return 'overwrite'
  } catch (action) {
    return action === 'cancel' ? 'new-directory' : null
  }
}

function revealResult() {
  const target = result.value?.outputPath || result.value?.reportPath
  if (target) void gameBuild.reveal(target)
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
</script>

<template>
  <main class="packaging-page" data-ui-id="game-packaging-page">
    <header class="page-header">
      <div>
        <h1>{{ t('gamePackaging.title') }}</h1>
        <p v-if="release">{{ release.version }} · {{ release.channel }}</p>
      </div>
      <div class="header-actions">
        <el-button :loading="checking" :disabled="!activePreset || building" data-ui-id="game-packaging-check" @click="runPreflight">
          {{ t('gamePackaging.check') }}
        </el-button>
        <el-button type="primary" :loading="building" :disabled="!activePreset || checking" data-ui-id="game-packaging-build" @click="build">
          {{ t('gamePackaging.build') }}
        </el-button>
      </div>
    </header>

    <div v-if="!hasProject" class="empty-state">{{ t('gamePackaging.noProject') }}</div>
    <div v-else-if="loading" class="empty-state">{{ t('gamePackaging.loading') }}</div>
    <el-alert v-else-if="error && !settings" :title="error" type="error" :closable="false" show-icon />

    <el-scrollbar v-else-if="settings && release && activePreset" class="page-scroll">
      <div class="packaging-form">
        <section class="preset-bar">
          <el-select :model-value="activePreset.id" data-ui-id="game-packaging-preset" @update:model-value="selectPreset(String($event))">
            <el-option v-for="preset in settings.presets" :key="preset.id" :value="preset.id" :label="preset.name" />
          </el-select>
          <el-button :icon="Plus" circle :title="t('gamePackaging.addPreset')" @click="addPreset" />
          <el-button :icon="Delete" circle :disabled="settings.presets.length <= 1" :title="t('gamePackaging.deletePreset')" @click="removePreset" />
        </section>

        <section class="form-section main-grid">
          <el-form-item :label="t('gamePackaging.presetName')">
            <el-input v-model="activePreset.name" />
          </el-form-item>
          <el-form-item :label="t('gameVersion.version')">
            <el-input v-model="release.version" data-ui-id="game-packaging-version" />
          </el-form-item>
          <el-form-item :label="t('gameVersion.channel')">
            <el-input v-model="release.channel" @update:model-value="activePreset.channel = String($event)" />
          </el-form-item>
          <el-form-item :label="t('gamePackaging.target')">
            <el-segmented :model-value="activePreset.target" :options="targets.map((target) => ({ value: target, label: t(`gamePackaging.target.${target}`) }))" @update:model-value="changeTarget($event as GameBuildTarget)" />
          </el-form-item>
          <el-form-item v-if="activePreset.target === 'windows'" :label="t('gamePackaging.architecture')">
            <el-select v-model="activePreset.architecture">
              <el-option value="x64" label="x64" />
              <el-option value="x86" label="x86" />
              <el-option value="arm64" label="ARM64" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('gamePackaging.packageType')">
            <el-select v-model="activePreset.packageType">
              <el-option value="full" :label="t('gamePackaging.package.full')" />
              <el-option value="file-delta" :label="t('gamePackaging.package.fileDelta')" />
              <el-option value="binary-diff" :label="t('gamePackaging.package.binaryDiff')" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="activePreset.packageType !== 'full'" :label="t('gamePackaging.baseReleaseId')">
            <el-input v-model="activePreset.baseReleaseId" />
          </el-form-item>
          <el-form-item class="output-field" :label="t('gamePackaging.outputDirectory')">
            <el-input v-model="activePreset.outputDirectory">
              <template #append><el-button :icon="FolderOpened" @click="selectOutput" /></template>
            </el-input>
          </el-form-item>
          <el-checkbox v-model="activePreset.zip">{{ t('gamePackaging.zip') }}</el-checkbox>
        </section>

        <section class="form-section">
          <h2>{{ t('gamePackaging.processing') }}</h2>
          <p class="section-note">{{ t('gamePackaging.processingNote') }}</p>
          <div class="processing-grid">
            <el-form-item v-for="category in processingCategories" :key="category" :label="t(`gamePackaging.processing.${category}`)">
              <el-select v-model="activePreset.processing[category]" @change="processingChanged">
                <el-option v-for="mode in processingModes" :key="mode" :value="mode" :label="t(`gamePackaging.processingMode.${mode}`)" />
              </el-select>
            </el-form-item>
          </div>
          <el-form-item v-if="activePreset.processing.encryptionKeyId" :label="t('gamePackaging.encryptionKeyId')">
            <div class="key-line">
              <el-select v-model="activePreset.processing.encryptionKeyId" :placeholder="t('gamePackaging.selectEncryptionKey')">
                <el-option v-for="key in encryptionKeys" :key="key.id" :value="key.id" :label="key.id" />
              </el-select>
              <el-button @click="generateEncryptionKey">{{ t('gamePackaging.generateEncryptionKey') }}</el-button>
              <el-button @click="importEncryptionKey">{{ t('gamePackaging.importEncryptionKey') }}</el-button>
            </div>
          </el-form-item>
        </section>

        <section v-if="activePreset.target === 'android' && activePreset.android" class="form-section">
          <h2>{{ t('gamePackaging.android') }}</h2>
          <div class="toolchain-line">
            <span>{{ androidToolchain?.configured ? t('gamePackaging.androidToolchainReady') : t('gamePackaging.androidToolchainMissing') }}</span>
            <el-button v-if="!androidToolchain?.configured" :loading="installingAndroidToolchain" @click="installAndroidToolchain">
              {{ t('gamePackaging.androidToolchainInstall') }}
            </el-button>
          </div>
          <div class="android-grid">
            <el-form-item :label="t('gamePackaging.applicationId')"><el-input v-model="activePreset.android.applicationId" /></el-form-item>
            <el-form-item :label="t('gamePackaging.displayName')"><el-input v-model="activePreset.android.displayName" /></el-form-item>
            <el-form-item :label="t('gamePackaging.versionCode')"><el-input-number v-model="activePreset.android.versionCode" :min="1" /></el-form-item>
            <el-form-item :label="t('gamePackaging.minSdk')"><el-input-number v-model="activePreset.android.minSdk" :min="23" :max="36" /></el-form-item>
            <el-form-item :label="t('gamePackaging.targetSdk')"><el-input-number v-model="activePreset.android.targetSdk" :min="activePreset.android.minSdk" :max="36" /></el-form-item>
            <el-form-item :label="t('gamePackaging.orientation')">
              <el-select v-model="activePreset.android.orientation">
                <el-option value="landscape" :label="t('gamePackaging.landscape')" />
                <el-option value="portrait" :label="t('gamePackaging.portrait')" />
                <el-option value="sensor" :label="t('gamePackaging.sensor')" />
              </el-select>
            </el-form-item>
            <el-form-item :label="t('gamePackaging.abis')">
              <el-select v-model="activePreset.android.abis" multiple>
                <el-option value="arm64-v8a" label="arm64-v8a" />
                <el-option value="armeabi-v7a" label="armeabi-v7a" />
                <el-option value="x86_64" label="x86_64" />
              </el-select>
            </el-form-item>
            <el-form-item :label="t('gamePackaging.icon')">
              <el-select v-model="activePreset.android.iconRelativePath" allow-create filterable>
                <el-option v-for="candidate in androidIconCandidates" :key="candidate" :label="candidate" :value="candidate" />
              </el-select>
            </el-form-item>
            <el-form-item :label="t('gamePackaging.splash')"><el-input v-model="activePreset.android.splashRelativePath" /></el-form-item>
            <el-checkbox v-model="activePreset.android.newApplication">{{ t('gamePackaging.newApplication') }}</el-checkbox>
            <el-form-item :label="t('gamePackaging.signing')">
              <el-radio-group v-model="activePreset.android.signing" @change="ensureCredentialReferences">
                <el-radio-button value="debug">Debug</el-radio-button>
                <el-radio-button value="release">Release</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <template v-if="activePreset.android.signing === 'release'">
              <el-form-item :label="t('gamePackaging.keystore')">
                <el-input v-model="activePreset.android.keystorePath">
                  <template #append><el-button :loading="creatingAndroidKeystore" @click="createAndroidKeystore">{{ t('gamePackaging.createKeystore') }}</el-button></template>
                </el-input>
              </el-form-item>
              <el-form-item :label="t('gamePackaging.keyAlias')"><el-input v-model="activePreset.android.keyAlias" /></el-form-item>
              <el-form-item :label="t('gamePackaging.storePassword')"><el-input v-model="signingStorePassword" type="password" show-password /></el-form-item>
              <el-form-item :label="t('gamePackaging.keyPassword')"><el-input v-model="signingKeyPassword" type="password" show-password /></el-form-item>
              <div class="credential-actions">
                <el-checkbox v-model="rememberSigningCredential" :disabled="!secureCredentialStorageAvailable">{{ t('gamePackaging.rememberCredential') }}</el-checkbox>
                <el-button v-if="signingCredentialRemembered" link type="danger" @click="forgetCredential('android-signing')">{{ t('gamePackaging.forgetCredential') }}</el-button>
              </div>
            </template>
          </div>
        </section>

        <section class="form-section">
          <div class="switch-line">
            <h2>{{ t('gamePackaging.upload') }}</h2>
            <el-switch :model-value="Boolean(activePreset.upload?.enabled)" @update:model-value="ensureUpload(Boolean($event))" />
          </div>
          <div v-if="activePreset.upload?.enabled" class="upload-grid">
            <el-form-item :label="t('gamePackaging.uploadAdapter')">
              <el-select v-model="activePreset.upload.adapter">
                <el-option value="webdav" label="WebDAV" />
                <el-option value="http-put" label="HTTP PUT" />
              </el-select>
            </el-form-item>
            <el-form-item :label="t('gamePackaging.serverUrl')"><el-input v-model="activePreset.upload.baseUrl" /></el-form-item>
            <el-form-item :label="t('gamePackaging.authorization')">
              <el-select v-model="activePreset.upload.authorization" @change="ensureCredentialReferences">
                <el-option value="none" :label="t('gamePackaging.auth.none')" />
                <el-option value="basic" label="Basic" />
                <el-option value="bearer" label="Bearer" />
              </el-select>
            </el-form-item>
            <template v-if="activePreset.upload.authorization === 'basic'">
              <el-form-item :label="t('gamePackaging.username')"><el-input v-model="uploadUsername" /></el-form-item>
              <el-form-item :label="t('gamePackaging.password')"><el-input v-model="uploadPassword" type="password" show-password /></el-form-item>
            </template>
            <el-form-item v-if="activePreset.upload.authorization === 'bearer'" :label="t('gamePackaging.token')">
              <el-input v-model="uploadToken" type="password" show-password />
            </el-form-item>
            <div v-if="activePreset.upload.authorization !== 'none'" class="credential-actions">
              <el-checkbox v-model="rememberUploadCredential" :disabled="!secureCredentialStorageAvailable">{{ t('gamePackaging.rememberCredential') }}</el-checkbox>
              <el-button v-if="uploadCredentialRemembered" link type="danger" @click="forgetCredential('upload')">{{ t('gamePackaging.forgetCredential') }}</el-button>
            </div>
          </div>
        </section>

        <section class="form-section">
          <h2>{{ t('gamePackaging.publication') }}</h2>
          <div class="publication-grid">
            <el-form-item class="publication-directory" :label="t('gamePackaging.publicationDirectory')">
              <el-input v-model="settings.publicationDirectory">
                <template #append><el-button :icon="FolderOpened" @click="selectPublicationDirectory" /></template>
              </el-input>
            </el-form-item>
            <el-form-item :label="t('gamePackaging.publicationDefaultLanguage')">
              <el-select v-model="publicationDefaultLanguage" allow-create filterable>
                <el-option v-for="language in publicationLanguageOptions" :key="language" :label="language" :value="language" />
              </el-select>
            </el-form-item>
            <el-checkbox v-model="publicationRequired">{{ t('gamePackaging.requiredUpdate') }}</el-checkbox>
          </div>
          <div class="publication-locales">
            <div v-for="(entry, index) in publicationLocales" :key="index" class="publication-locale">
              <div class="publication-locale-heading">
                <el-input
                  :model-value="entry.language"
                  :placeholder="t('gamePackaging.publicationLanguage')"
                  @update:model-value="updatePublicationLanguage(index, String($event))"
                />
                <el-button
                  :icon="Delete"
                  :disabled="publicationLocales.length <= 1"
                  :aria-label="t('gamePackaging.removeLanguage')"
                  @click="removePublicationLocale(index)"
                />
              </div>
              <el-form-item :label="t('gamePackaging.publicationTitle')"><el-input v-model="entry.title" /></el-form-item>
              <el-form-item :label="t('gamePackaging.publicationSummary')"><el-input v-model="entry.summary" type="textarea" :rows="2" /></el-form-item>
              <el-form-item :label="t('gamePackaging.maintenance')"><el-input v-model="entry.maintenance" type="textarea" :rows="2" /></el-form-item>
            </div>
            <el-button :icon="Plus" @click="addPublicationLocale">{{ t('gamePackaging.addLanguage') }}</el-button>
          </div>
          <div class="manifest-signing-line">
            <el-switch
              :model-value="Boolean(release.update.manifestSignature?.enabled)"
              :disabled="!release.update.enabled || (!release.update.manifestSignature && !secureCredentialStorageAvailable)"
              @update:model-value="setManifestSigning(Boolean($event))"
            />
            <span>{{ t('gamePackaging.manifestSigning') }}</span>
            <code v-if="release.update.manifestSignature">{{ release.update.manifestSignature.keyId }}</code>
            <el-button
              :loading="creatingManifestSigningIdentity"
              :disabled="!release.update.enabled || !secureCredentialStorageAvailable"
              @click="createManifestSigningIdentity"
            >{{ release.update.manifestSignature ? t('gamePackaging.manifestSigningReplace') : t('gamePackaging.manifestSigningCreate') }}</el-button>
            <el-button
              v-if="manifestSigningCredentialRemembered"
              link
              type="danger"
              @click="forgetCredential('manifest-signing')"
            >{{ t('gamePackaging.forgetCredential') }}</el-button>
          </div>
          <p class="section-note">{{ t('gamePackaging.manifestSigningRisk') }}</p>
        </section>

        <section v-if="preflight" class="check-result" :class="preflight.ok ? 'is-ok' : 'is-error'">
          <h2>{{ preflight.ok ? t('gamePackaging.checkPassed') : t('gamePackaging.checkFailed') }}</h2>
          <ul v-if="preflight.blockers.length"><li v-for="item in preflight.blockers" :key="item">{{ item }}</li></ul>
          <ul v-if="preflight.warnings.length"><li v-for="item in preflight.warnings" :key="item">{{ item }}</li></ul>
        </section>

        <section v-if="result?.status === 'success'" class="build-result">
          <div><h2>{{ t('gamePackaging.buildSucceeded') }}</h2><code>{{ result.outputPath }}</code></div>
          <div class="result-actions">
            <el-button @click="revealResult">{{ t('gamePackaging.showOutput') }}</el-button>
            <el-button type="primary" :loading="publishing" @click="publishRelease()">{{ activePreset.upload?.enabled ? t('gamePackaging.publishAndUpload') : t('gamePackaging.publishLocal') }}</el-button>
          </div>
        </section>
        <section v-if="published" class="build-result">
          <div><h2>{{ t('gamePackaging.publishSucceeded') }}</h2><code>{{ published.releaseDirectory }}</code></div>
          <el-button @click="gameBuild.reveal(published.releaseDirectory)">{{ t('gamePackaging.showOutput') }}</el-button>
        </section>
        <el-alert v-else-if="error" :title="error" type="error" :closable="false" show-icon />
      </div>
    </el-scrollbar>
  </main>
</template>

<style scoped>
.packaging-page { height: 100%; min-width: 0; display: flex; flex-direction: column; background: var(--app-bg); }
.page-header { min-height: 64px; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--app-border); }
h1, h2, p { margin: 0; }
h1 { font-size: 18px; color: var(--app-ink); }
h2 { font-size: 14px; color: var(--app-ink); }
.page-header p { margin-top: 4px; color: var(--app-ink-muted); font-size: 12px; }
.header-actions, .preset-bar { display: flex; align-items: center; gap: 8px; }
.page-scroll { flex: 1; min-height: 0; }
.packaging-form { width: min(860px, calc(100% - 40px)); margin: 20px auto 40px; display: grid; gap: 14px; }
.preset-bar :deep(.el-select) { width: 260px; }
.form-section { padding: 18px; border: 1px solid var(--app-border); border-radius: var(--app-radius-lg); background: var(--app-bg-elevated); }
.main-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 14px; }
.main-grid :deep(.el-form-item) { margin-bottom: 14px; }
.output-field { grid-column: span 2; }
.processing-grid, .android-grid, .upload-grid, .publication-grid { margin-top: 14px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 14px; }
.publication-locales { display: grid; gap: 10px; margin-top: 12px; }
.publication-locale { padding: 12px; border: 1px solid var(--app-border); border-radius: var(--app-radius-md); }
.publication-locale-heading { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.publication-locale-heading :deep(.el-input) { max-width: 220px; }
.publication-locale :deep(.el-form-item:last-child) { margin-bottom: 0; }
.toolchain-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; color: var(--el-text-color-secondary); }
.key-line, .result-actions { display: flex; align-items: center; gap: 8px; }
.credential-actions { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.manifest-signing-line { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
.manifest-signing-line code { min-width: 0; overflow: hidden; color: var(--app-ink-soft); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.key-line { width: 100%; }
.key-line :deep(.el-select) { flex: 1; }
.publication-directory, .publication-summary { grid-column: span 2; }
.section-note { margin-top: 5px; color: var(--app-ink-muted); font-size: 12px; }
.switch-line { display: flex; align-items: center; justify-content: space-between; }
.check-result, .build-result { padding: 16px 18px; border-radius: var(--app-radius-lg); border: 1px solid var(--app-border); }
.check-result.is-ok, .build-result { border-color: var(--el-color-success-light-5); background: var(--el-color-success-light-9); }
.check-result.is-error { border-color: var(--el-color-danger-light-5); background: var(--el-color-danger-light-9); }
.check-result ul { margin: 8px 0 0; padding-left: 20px; color: var(--app-ink-soft); font-size: 12px; line-height: 1.6; }
.build-result { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.build-result code { display: block; margin-top: 7px; color: var(--app-ink-soft); font-size: 11px; word-break: break-all; }
.empty-state { flex: 1; display: grid; place-items: center; color: var(--app-ink-muted); }
@media (max-width: 960px) { .main-grid, .processing-grid, .android-grid, .upload-grid, .publication-grid { grid-template-columns: 1fr 1fr; } }
</style>
