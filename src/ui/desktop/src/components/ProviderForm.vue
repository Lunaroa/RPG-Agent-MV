<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? 'Edit Provider' : 'Add Provider'"
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
      <el-form-item label="Provider ID" prop="id">
        <el-input
          v-model="form.id"
          :disabled="isEdit"
          placeholder="e.g., deepseek, openai"
        />
      </el-form-item>

      <el-form-item label="Display Name" prop="displayName">
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
          :placeholder="isEdit && provider?.credentialPresent ? '(已存) 留空保留原值' : '粘贴新的 API key'"
        />
        <div class="form-hint">
          {{ isEdit && provider?.credentialPresent ? '留空表示保留原值；填入新值会更新凭证' : '填入后保存会写入安全存储' }}
        </div>
      </el-form-item>

      <el-form-item label="Default Model" prop="defaultModel">
        <el-input
          v-model="form.defaultModel"
          placeholder="deepseek-chat"
        />
      </el-form-item>

      <el-form-item label="Models (每行一个)" prop="modelsText">
        <div class="models-header">
          <span>Model IDs</span>
          <el-button
            type="primary"
            link
            :loading="fetchingModels"
            :disabled="!isEdit || !provider?.credentialPresent"
            @click="handleFetchModels"
          >
            从 API 拉取最新
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

      <el-form-item label="opencode 凭证变量">
        <el-input
          v-model="form.agentRuntimeEnvVar"
          placeholder="ANTHROPIC_API_KEY"
        />
        <div class="form-hint">
          启动本地执行器时，将密钥注入到这个环境变量
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
            Delete
          </el-button>
          <el-button
            v-if="isEdit"
            :loading="testing"
            @click="handleTest"
          >
            Test Connection
          </el-button>
        </div>
        <div class="footer-right">
          <el-button @click="handleClose">Cancel</el-button>
          <el-button type="primary" :loading="saving" @click="handleSave">
            {{ isEdit ? 'Save' : 'Create' }}
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

const rules: FormRules = {
  id: [
    { required: true, message: 'Please enter provider ID', trigger: 'blur' },
    { pattern: /^[a-z0-9-]+$/, message: 'Only lowercase letters, numbers, and hyphens', trigger: 'blur' }
  ],
  displayName: [
    { required: true, message: 'Please enter display name', trigger: 'blur' }
  ],
  baseUrl: [
    { required: true, message: 'Please enter base URL', trigger: 'blur' },
    { type: 'url', message: 'Please enter a valid URL', trigger: 'blur' }
  ]
}

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
        ElMessage.success('Provider updated successfully')
      } else {
        await settings.createProvider(form.id, payload)
        ElMessage.success('Provider created successfully')
      }
      
      emit('saved')
      visible.value = false
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : 'Failed to save provider')
    } finally {
      saving.value = false
    }
  })
}

async function handleDelete() {
  if (!props.provider) return
  
  try {
    await ElMessageBox.confirm(
      `Are you sure you want to delete provider "${props.provider.id}"?`,
      'Confirm Delete',
      { type: 'warning' }
    )
    
    await settings.deleteProvider(props.provider.id)
    ElMessage.success('Provider deleted successfully')
    emit('deleted')
    visible.value = false
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error instanceof Error ? error.message : 'Failed to delete provider')
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
        message: `Failed: ${result.error || 'Unknown error'}`
      }
    }
  } catch (error) {
    testResult.value = {
      ok: false,
      message: `Request failed: ${error instanceof Error ? error.message : String(error)}`
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
        message: `Fetched ${result.models.length} models, added ${newModels.length} new`
      }
    } else {
      fetchModelsResult.value = {
        ok: false,
        message: result.error || 'No models returned'
      }
    }
  } catch (error) {
    fetchModelsResult.value = {
      ok: false,
      message: `Request failed: ${error instanceof Error ? error.message : String(error)}`
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
