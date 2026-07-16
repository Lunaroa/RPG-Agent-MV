<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
  EditorActorBattleProfile,
  EditorProjectCatalog,
  InteractiveBattleTestBattler,
} from '../../api/client';
import { useI18n } from '../../i18n';

const props = defineProps<{
  visible: boolean;
  busy: boolean;
  catalog: EditorProjectCatalog | null;
  troopName: string;
  battleback1Name: string;
  battleback2Name: string;
}>();

const emit = defineEmits<{
  close: [];
  start: [value: { battlers: InteractiveBattleTestBattler[]; battleback1Name: string; battleback2Name: string }];
}>();

const { t } = useI18n();
const battlers = ref<InteractiveBattleTestBattler[]>([]);
const battleback1Name = ref('');
const battleback2Name = ref('');
const error = ref('');

const canAdd = computed(() => battlers.value.length < 4 && availableActorIds().length > 0);

watch(() => props.visible, (visible) => {
  if (!visible) return;
  const defaults = props.catalog?.battle.testBattlers || [];
  const seen = new Set<number>();
  battlers.value = defaults.flatMap((entry) => {
    const actor = profile(entry.actorId);
    if (seen.has(entry.actorId) || !actor || seen.size >= 4) return [];
    seen.add(entry.actorId);
    return [{
      actorId: entry.actorId,
      level: clamp(entry.level, 1, 99),
      equips: normalizedEquips(actor, entry.equips),
    }];
  });
  if (!battlers.value.length) addBattler();
  battleback1Name.value = props.battleback1Name;
  battleback2Name.value = props.battleback2Name;
  error.value = '';
});

function profile(actorId: number): EditorActorBattleProfile | undefined {
  return props.catalog?.battle.actorProfiles.find((entry) => entry.actorId === actorId);
}

function availableActorIds(excludeIndex = -1): number[] {
  const used = new Set(battlers.value.flatMap((entry, index) => index === excludeIndex ? [] : [entry.actorId]));
  return (props.catalog?.actors || []).map((actor) => actor.id).filter((actorId) => !used.has(actorId) && profile(actorId));
}

function actorOptions(index: number) {
  const allowed = new Set([battlers.value[index]?.actorId, ...availableActorIds(index)]);
  return (props.catalog?.actors || []).filter((actor) => allowed.has(actor.id));
}

function addBattler(): void {
  if (battlers.value.length >= 4) return;
  const actorId = availableActorIds()[0];
  if (actorId === undefined) return;
  const actor = profile(actorId);
  if (!actor) return;
  battlers.value = [...battlers.value, {
    actorId,
    level: clamp(actor.initialLevel, 1, 99),
    equips: normalizedEquips(actor, actor.initialEquips),
  }];
}

function removeBattler(index: number): void {
  battlers.value = battlers.value.filter((_entry, entryIndex) => entryIndex !== index);
}

function changeActor(index: number, actorId: number): void {
  const actor = profile(actorId);
  if (!actor) return;
  const next = [...battlers.value];
  next[index] = {
    actorId,
    level: clamp(actor.initialLevel, 1, 99),
    equips: normalizedEquips(actor, actor.initialEquips),
  };
  battlers.value = next;
}

function updateLevel(index: number, value: unknown): void {
  const next = [...battlers.value];
  next[index] = { ...next[index], level: clamp(value, 1, 99) };
  battlers.value = next;
}

function equipRows(battler: InteractiveBattleTestBattler): number[] {
  const actor = profile(battler.actorId);
  return Array.from({ length: Math.max(battler.equips.length, actor?.equipSlotTypeIds.length || 0) }, (_entry, index) => index);
}

function isStandardSlot(battler: InteractiveBattleTestBattler, slotIndex: number): boolean {
  return slotIndex < (profile(battler.actorId)?.equipSlotTypeIds.length || 0);
}

function slotLabel(battler: InteractiveBattleTestBattler, slotIndex: number): string {
  const typeId = profile(battler.actorId)?.equipSlotTypeIds[slotIndex];
  const type = props.catalog?.equipTypes.find((entry) => entry.id === typeId);
  return type ? `${slotIndex + 1}. ${type.name}` : t('db.pluginEquipSlotN', { n: slotIndex + 1 });
}

function equipmentOptions(battler: InteractiveBattleTestBattler, slotIndex: number) {
  const typeId = profile(battler.actorId)?.equipSlotTypeIds[slotIndex];
  const entries = typeId === 1
    ? (props.catalog?.weapons || []).filter((entry) => entry.etypeId === typeId)
    : (props.catalog?.armors || []).filter((entry) => entry.etypeId === typeId);
  return [{ id: 0, name: t('imgPicker.none') }, ...entries];
}

function updateEquip(index: number, slotIndex: number, equipId: number): void {
  const next = [...battlers.value];
  const equips = [...next[index].equips];
  equips[slotIndex] = equipId;
  next[index] = { ...next[index], equips };
  battlers.value = next;
}

function start(): void {
  const actorIds = battlers.value.map((entry) => entry.actorId);
  if (battlers.value.length < 1 || battlers.value.length > 4) {
    error.value = t('battleTest.actorCountError');
    return;
  }
  if (new Set(actorIds).size !== actorIds.length) {
    error.value = t('battleTest.duplicateActors');
    return;
  }
  error.value = '';
  emit('start', {
    battlers: battlers.value.map((entry) => ({ ...entry, equips: [...entry.equips] })),
    battleback1Name: battleback1Name.value,
    battleback2Name: battleback2Name.value,
  });
}

function normalizedEquips(actor: EditorActorBattleProfile, value: readonly number[]): number[] {
  const equips = [...value];
  while (equips.length < actor.equipSlotTypeIds.length) equips.push(0);
  return equips;
}

function clamp(value: unknown, minimum: number, maximum: number): number {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? Math.trunc(number) : minimum));
}
</script>

<template>
  <el-dialog
    class="battle-test-dialog"
    data-ui-id="battle-test-dialog"
    :model-value="visible"
    :title="t('battleTest.title', { troop: troopName })"
    width="min(680px, 92vw)"
    top="5vh"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @close="emit('close')"
  >
    <div class="battle-test-setup">
      <div class="battle-test-heading">
        <span>{{ t('battleTest.members') }}</span>
        <button type="button" :disabled="!canAdd || busy" @click="addBattler">{{ t('cmdList.add') }}</button>
      </div>
      <div class="battle-test-members">
        <article v-for="(battler, index) in battlers" :key="`battle-test-${index}`" class="battle-test-member">
          <div class="battle-test-member-head">
            <label>
              <span>{{ t('mapPreview.actor') }}</span>
              <select :value="battler.actorId" :disabled="busy" @change="changeActor(index, Number(($event.target as HTMLSelectElement).value))">
                <option v-for="actor in actorOptions(index)" :key="actor.id" :value="actor.id">{{ actor.name }}</option>
              </select>
            </label>
            <label>
              <span>{{ t('db.level') }}</span>
              <input type="number" min="1" max="99" :value="battler.level" :disabled="busy" @input="updateLevel(index, ($event.target as HTMLInputElement).value)" />
            </label>
            <button type="button" class="danger" :disabled="busy" @click="removeBattler(index)">{{ t('cmdList.delete') }}</button>
          </div>
          <div class="battle-test-equips">
            <label v-for="slotIndex in equipRows(battler)" :key="`battle-equip-${index}-${slotIndex}`">
              <span>{{ slotLabel(battler, slotIndex) }}</span>
              <select v-if="isStandardSlot(battler, slotIndex)" :value="battler.equips[slotIndex] || 0" :disabled="busy" @change="updateEquip(index, slotIndex, Number(($event.target as HTMLSelectElement).value))">
                <option v-for="option in equipmentOptions(battler, slotIndex)" :key="option.id" :value="option.id">{{ option.name }}</option>
              </select>
              <small v-else>{{ battler.equips[slotIndex] || 0 }} · {{ t('db.pluginEquipSlotReadonly') }}</small>
            </label>
          </div>
        </article>
      </div>
      <div class="battle-test-backgrounds">
        <label>
          <span>{{ t('db.battleback1') }}</span>
          <select v-model="battleback1Name" :disabled="busy">
            <option value="">{{ t('imgPicker.none') }}</option>
            <option v-for="asset in catalog?.assets.battlebacks1 || []" :key="asset.name" :value="asset.name">{{ asset.name }}</option>
          </select>
        </label>
        <label>
          <span>{{ t('db.battleback2') }}</span>
          <select v-model="battleback2Name" :disabled="busy">
            <option value="">{{ t('imgPicker.none') }}</option>
            <option v-for="asset in catalog?.assets.battlebacks2 || []" :key="asset.name" :value="asset.name">{{ asset.name }}</option>
          </select>
        </label>
      </div>
      <p class="battle-test-note">{{ t('battleTest.isolationNote') }}</p>
      <p v-if="error" class="battle-test-error">{{ error }}</p>
    </div>
    <template #footer>
      <button type="button" :disabled="busy" @click="emit('close')">{{ t('editor.mapProperties.cancel') }}</button>
      <button type="button" class="primary" data-ui-id="battle-test-start" :disabled="busy || !battlers.length" @click="start">
        {{ busy ? t('battleTest.starting') : t('battleTest.start') }}
      </button>
    </template>
  </el-dialog>
</template>

<style scoped>
:global(.battle-test-dialog) {
  display: flex;
  max-height: 90vh;
  flex-direction: column;
}
:global(.battle-test-dialog .el-dialog__body) {
  min-height: 0;
  overflow: auto;
}
:global(.battle-test-dialog .el-dialog__footer) {
  flex: 0 0 auto;
}
.battle-test-setup,
.battle-test-members,
.battle-test-member {
  display: grid;
  gap: 9px;
}
.battle-test-heading,
.battle-test-member-head,
.battle-test-backgrounds,
.battle-test-equips {
  display: grid;
  gap: 8px;
}
.battle-test-heading { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
.battle-test-heading span { font-weight: 650; }
.battle-test-member {
  padding: 9px;
  border: 1px solid var(--console-border, #ddd5c8);
  border-radius: 5px;
  background: var(--console-paper-soft, #faf5ec);
}
.battle-test-member-head { grid-template-columns: minmax(0, 1fr) 100px auto; align-items: end; }
.battle-test-backgrounds,
.battle-test-equips { grid-template-columns: repeat(2, minmax(0, 1fr)); }
label { display: grid; gap: 4px; min-width: 0; }
label span,
label small { color: var(--console-text-muted, #776f64); font-size: 11px; }
.battle-test-note { margin: 0; color: var(--console-text-muted, #776f64); font-size: 11px; }
.battle-test-error { margin: 0; color: var(--el-color-danger); font-size: 12px; }
button.primary { border-color: var(--app-accent, #9a6a2f); background: var(--app-accent, #9a6a2f); color: #fff; }
@media (max-width: 620px) {
  .battle-test-member-head,
  .battle-test-backgrounds,
  .battle-test-equips { grid-template-columns: minmax(0, 1fr); }
}
</style>
