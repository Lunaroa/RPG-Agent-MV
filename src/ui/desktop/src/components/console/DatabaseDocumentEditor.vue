<script setup lang="ts">
import type { EditorProjectCatalog } from '../../api/client';
import type { RmmvDatabaseEntrySchema } from '@contract/types';
import type { DatabaseDocumentPage } from '../../utils/databaseDocumentPages';
import DatabaseSystemDocumentEditor from './DatabaseSystemDocumentEditor.vue';
import DatabaseTypesDocumentEditor from './DatabaseTypesDocumentEditor.vue';
import DatabaseTermsDocumentEditor from './DatabaseTermsDocumentEditor.vue';

defineProps<{
  modelValue: unknown;
  page: DatabaseDocumentPage;
  catalog: EditorProjectCatalog | null;
  schema?: RmmvDatabaseEntrySchema;
  loadImage?: (url: string) => Promise<HTMLImageElement | null>;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();
</script>

<template>
  <DatabaseSystemDocumentEditor
    v-if="page === 'System1' || page === 'System2'"
    :model-value="modelValue"
    :page="page"
    :catalog="catalog"
    :schema="schema"
    :load-image="loadImage"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <DatabaseTypesDocumentEditor
    v-else-if="page === 'Types'"
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <DatabaseTermsDocumentEditor
    v-else
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
