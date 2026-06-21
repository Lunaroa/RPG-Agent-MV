<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? t('provider.editTitle') : t('provider.addTitle')"
    width="600px"
    @close="handleClose"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-position="top"
      class="provider-form"
    >
      <el-form-item :label="t('provider.id')" prop="id">
        <el-input
          v-model="form.id"
          :disabled="isEdit"
          placeholder="e.g., deepseek, openai"
        />
      </el-form-item>

      <el-form-item :label="t('provider.displayName')" prop="displayName">
        <el-input
          v-model="form.displayName"
          placeholder="e.g., DeepSeek (Official)"
        />
      </el-form-item>

      <el-form-item label="Base URL" prop="baseUrl">
        <el-input
          v-model="form.baseUrl"
          placeholder="https://api.deepseek.com/v1"
        />
      </el-form-item>

      <el-form-item label="API Key" prop="credentialValue">
        <el-input
          v-model="form.credentialValue"
          type="password"
          show-password
          :placeholder="isEdit && provider?.credentialPresent ? t('provider.credentialSavedKeep') : t('provider.credentialNew')"
        />
        <div class="form-hint">
          {{ isEdit && provider?.credentialPresent ? t('provider.credentialSavedHint') : t('provider.credentialNewHint') }}
        </div>
      </el-form-item>

      <el-form-item :label="t('provider.defaultModel')" prop="defaultModel">
        <el-input
          v-model="form.defaultModel"
          placeholder="deepseek-chat"
        />
      </el-form-item>

      <el-form-item :label="t('provider.modelsLabel')" prop="modelsText">
        <div class="models-header">
          <span>Model IDs</span>
          <el-button
            type="primary"
            link
            :loading="fetchingModels"
            :disabled="!isEdit || !provider?.credentialPresent"
            @click="handleFetchModels"
          >
            {{ t('provider.fetchFromApi') }}
          </el-button>
        </div>
        <el-input
          v-model="form.modelsText"
          type="textarea"
          :rows="4"
          placeholder="deepseek-chat&#10;deepseek-reasoner"
        />
        <div v-if="fetchModelsResult" class="form-hint" :class="fetchModelsResult.ok ? 'success' : 'error'">
          {{ fetchModelsResult.message }}
        </div>
      </el-form-item>

      <el-form-item :label="t('provider.credentialVar')">
        <el-input
          v-model="form.agentRuntimeEnvVar"
          placeholder="ANTHROPIC_API_KEY"
        />
        <div class="form-hint">
          {{ t('provider.credentialVarHint') }}
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <div class="footer-left">
          <el-button
            v-if="isEdit"
            type="danger"
            @click="handleDelete"
          >
            {{ t('provider.delete') }}
          </el-button>
          <el-button
            v-if="isEdit"
            :loading="testing"
            @click="handleTest"
          >
            {{ t('provider.testConnection') }}
          </el-button>
        </div>
        <div class="footer-right">
          <el-button @click="handleClose">{{ t('provider.cancel') }}</el-button>
          <el-button type="primary" :loading="saving" @click="handleSave">
            {{ isEdit ? t('provider.save') : t('provider.create') }}
          </el-button>
        </div>
      </div>
      <div v-if="testResult" class="test-result" :class="testResult.ok ? 'success' : 'error'">
        {{ testResult.message }}
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { settings } from '../api/client'
import type { ProviderSummary } from '../api/client'
import { useI18n } from '../i18n'

interface Props {
  modelValue: boolean
  provider?: ProviderSummary | null
}

const props = withDefaults(defineProps<Props>(), {
  provider: null
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
  deleted: []
}>()

const { t } = useI18n()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const isEdit = computed(() => !!props.provider?.id)

const formRef = ref<FormInstance>()
const saving = ref(false)
const testing = ref(false)
const fetchingModels = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const fetchModelsResult = ref<{ ok: boolean; message: string } | null>(null)

const form = reactive({
  id: '',
  displayName: '',
  baseUrl: '',
  credentialValue: '',
  defaultModel: '',
  modelsText: '',
  agentRuntimeEnvVar: 'ANTHROPIC_API_KEY'
})

const rules = computed<FormRules>(() => ({
  id: [
    { required: true, message: t('provider.idRequired'), trigger: 'blur' },
    { pattern: /^[a-z0-9-]+$/, message: t('provider.idPattern'), trigger: 'blur' }
  ],
  displayName: [
    { required: true, message: t('provider.nameRequired'), trigger: 'blur' }
  ],
  baseUrl: [
    { required: true, message: t('provider.urlRequired'), trigger: 'blur' },
    { type: 'url', message: t('provider.urlInvalid'), trigger: 'blur' }
  ]
}))

watch(() => props.provider, (provider) => {
  if (provider) {
    form.id = provider.id || ''
    form.displayName = provider.displayName || ''
    form.baseUrl = provider.baseUrl || ''
    form.defaultModel = provider.defaultModel || ''
    form.modelsText = (provider.models || []).map(m => typeof m === 'string' ? m : m.id).join('\n')
    form.agentRuntimeEnvVar = provider.opencodeAuth?.envVar || 'ANTHROPIC_API_KEY'
  } else {
    form.id = ''
    form.displayName = ''
    form.baseUrl = ''
    form.defaultModel = ''
    form.modelsText = ''
    form.agentRuntimeEnvVar = 'ANTHROPIC_API_KEY'
  }
  form.credentialValue = ''
  testResult.value = null
  fetchModelsResult.value = null
}, { immediate: true })

function handleClose() {
  visible.value = false
}

function inferProtocol(baseUrl: string, presetProtocol?: string, existingProtocol?: string): string {
  if (presetProtocol) return presetProtocol
  if (existingProtocol) return existingProtocol
  const url = String(baseUrl || '').toLowerCase()
  // Anthropic official API or third-party Anthropic-compatible relays.
  if (url.includes('anthropic.com') || url.includes('/anthropic')) return 'anthropic'
  // Everything else runs through opencode's OpenAI-compatible provider path.
  return 'openai-compatible'
}

async function handleSave() {
  if (!formRef.value) return
  
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    
    saving.value = true
    try {
      const protocol = inferProtocol(
        form.baseUrl,
        undefined,
        props.provider?.protocol,
      )
      const isAnthropic = protocol === 'anthropic'
      const payload: any = {
        label: form.displayName,
        protocol,
        baseUrl: form.baseUrl,
        defaultModel: form.defaultModel,
        models: form.modelsText
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean)
          .map(id => ({ id, label: id })),
        opencodeAuth: {
          enabled: true,
          // openai-compatible providers ignore this var; opencode receives OPENAI_API_KEY.
          envVar: isAnthropic ? (form.agentRuntimeEnvVar || 'ANTHROPIC_API_KEY') : 'ANTHROPIC_API_KEY',
        },
        supportedEngines: ['opencode'],
        presetKind: 'custom',
      }
      
      if (form.credentialValue.trim()) {
        payload.credentialValue = form.credentialValue
      }
      
      if (isEdit.value) {
        await settings.updateProvider(form.id, payload)
        ElMessage.success(t('provider.updated'))
      } else {
        await settings.createProvider(form.id, payload)
        ElMessage.success(t('provider.created'))
      }

      emit('saved')
      visible.value = false
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : t('provider.saveFailed'))
    } finally {
      saving.value = false
    }
  })
}

async function handleDelete() {
  if (!props.provider) return
  
  try {
    await ElMessageBox.confirm(
      t('provider.deleteConfirm', { id: props.provider.id }),
      t('provider.deleteConfirmTitle'),
      { type: 'warning' }
    )

    await settings.deleteProvider(props.provider.id)
    ElMessage.success(t('provider.deleted'))
    emit('deleted')
    visible.value = false
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error instanceof Error ? error.message : t('provider.deleteFailed'))
    }
  }
}

async function handleTest() {
  if (!props.provider) return
  
  testing.value = true
  testResult.value = null
  
  try {
    const result = await settings.testProvider(props.provider.id)
    if (result.ok) {
      testResult.value = {
        ok: true,
        message: `OK ${result.latencyMs}ms · ${result.model || ''}`
      }
    } else {
      testResult.value = {
        ok: false,
        message: t('provider.testFailed', { error: result.error || t('provider.testUnknownError') })
      }
    }
  } catch (error) {
    testResult.value = {
      ok: false,
      message: t('provider.requestFailed', { error: error instanceof Error ? error.message : String(error) })
    }
  } finally {
    testing.value = false
  }
}

async function handleFetchModels() {
  if (!props.provider) return
  
  fetchingModels.value = true
  fetchModelsResult.value = null
  
  try {
    const result = await settings.fetchModels(props.provider.id, { persist: true })
    if (result.ok && result.models && result.models.length > 0) {
      const currentIds = new Set(
        form.modelsText
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean)
      )
      
      const newModels = result.models.filter(m => !currentIds.has(m.id))
      if (newModels.length > 0) {
        form.modelsText = [
          ...form.modelsText.split(/\r?\n/).filter(line => line.trim()),
          ...newModels.map(m => m.id)
        ].join('\n')
      }
      
      fetchModelsResult.value = {
        ok: true,
        message: t('provider.modelsFetched', { total: result.models.length, added: newModels.length })
      }
    } else {
      fetchModelsResult.value = {
        ok: false,
        message: result.error || t('provider.noModelsReturned')
      }
    }
  } catch (error) {
    fetchModelsResult.value = {
      ok: false,
      message: t('provider.requestFailed', { error: error instanceof Error ? error.message : String(error) })
    }
  } finally {
    fetchingModels.value = false
  }
}
</script>

<style scoped>
.provider-form {
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 16px;
}

.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.form-hint.success {
  color: var(--el-color-success);
}

.form-hint.error {
  color: var(--el-color-danger);
}

.models-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.mt-2 {
  margin-top: 8px;
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer-left,
.footer-right {
  display: flex;
  gap: 8px;
}

.test-result {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
}

.test-result.success {
  background-color: var(--el-color-success-light-9);
  color: var(--el-color-success);
}

.test-result.error {
  background-color: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
</style>
