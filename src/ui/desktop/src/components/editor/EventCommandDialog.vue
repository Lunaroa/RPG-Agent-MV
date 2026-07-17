<template>
  <teleport to="body">
    <div v-if="visible" class="ev-modal-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.commandDialog" @mousedown.self="close">
      <section class="cmd-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="command-dialog-title">
        <header class="editor-modal-header">
          <strong id="command-dialog-title" class="editor-modal-title">{{ dialogTitle }}</strong>
          <button type="button" class="editor-modal-close" :aria-label="t('eventcmd.closeEditor')" :title="t('eventcmd.close')" @click="close">×</button>
        </header>

        <div v-if="pickerOpen" class="picker-shell" @keydown="onPickerKeyDown">
          <nav class="command-page-tabs editor-tab-strip" :aria-label="t('eventcmd.pages')">
            <button
              v-for="page in 3"
              :key="page"
              type="button"
              :class="{ active: pickerPage === page && !pickerQuery.trim() }"
              :aria-pressed="pickerPage === page && !pickerQuery.trim()"
              @click="selectPickerPage(page)"
            >
              {{ page }}
            </button>
          </nav>
          <label class="picker-search">
            <span>{{ t('eventcmd.searchLabel') }}</span>
            <input
              ref="pickerSearchRef"
              v-model="pickerQuery"
              type="search"
              role="combobox"
              autocomplete="off"
              :placeholder="t('eventcmd.searchPlaceholder')"
              :aria-controls="pickerListId"
              :aria-expanded="true"
              :aria-activedescendant="activePickerOptionId || undefined"
            />
          </label>
          <div :id="pickerListId" ref="pickerListRef" class="picker" role="listbox" :aria-label="t('eventcmd.commandList')">
            <section v-for="category in currentCategories" :key="`${category.page}:${category.group}`" class="picker-group" role="group" :aria-label="category.group">
              <h4>
                <span>{{ category.group }}</span>
                <small v-if="pickerQuery.trim()">{{ t('eventcmd.pageN', { n: category.page }) }}</small>
              </h4>
              <div>
                <button
                  v-for="item in category.items"
                  :id="pickerOptionId(item.code)"
                  :key="item.code"
                  type="button"
                  role="option"
                  :aria-selected="activePickerCode === item.code"
                  :class="{ active: activePickerCode === item.code }"
                  @mouseenter="activatePickerItem(item.code)"
                  @focus="activatePickerItem(item.code)"
                  @click="pick(item.kind)"
                >
                  {{ item.label }}...
                </button>
              </div>
            </section>
            <p v-if="!currentCategories.length" class="picker-empty" role="status">{{ t('eventcmd.noSearchResults') }}</p>
          </div>
        </div>

        <div v-else-if="draft" class="editor-body">
          <div class="editor-heading">
            <strong>{{ commandTitle }}</strong>
          </div>

          <div class="fields">
            <template v-if="draft.code === 101">
              <div class="text-cmd-layout">
                <div class="text-cmd-face">
                  <canvas ref="facePreviewRef" class="face-preview" :width="faceSize" :height="faceSize" @click="openTextFacePicker" />
                  <button type="button" class="editor-btn" @click="openTextFacePicker">{{ t('eventcmd.choose') }}</button>
                </div>
                <label class="text-cmd-text">{{ t('eventcmd.text') }}<textarea v-model="multiText" rows="5" /></label>
              </div>
              <div class="text-cmd-options">
                <label>{{ t('eventcmd.background') }}<select :value="numberParam(2)" @change="setParam(2, numberValue($event))"><option :value="0">{{ t('eventcmd.bgWindow') }}</option><option :value="1">{{ t('eventcmd.bgDim') }}</option><option :value="2">{{ t('eventcmd.bgTransparent') }}</option></select></label>
                <label>{{ t('eventcmd.position') }}<select :value="numberParam(3,2)" @change="setParam(3, numberValue($event))"><option :value="0">{{ t('eventcmd.posTop') }}</option><option :value="1">{{ t('eventcmd.posMiddle') }}</option><option :value="2">{{ t('eventcmd.posBottom') }}</option></select></label>
                <label v-if="currentEngine === 'rpg-maker-mz'">{{ t('eventcmd.speakerName') }}<input :value="stringParam(4)" @input="setParam(4,inputValue($event))" /></label>
              </div>
            </template>
            <template v-else-if="draft.code === 102">
              <label class="full">{{ t('eventcmd.choices') }}<textarea :value="choicesText" rows="6" @input="setChoices" /></label>
              <p class="form-note">{{ t('eventcmd.choicesNote') }}</p>
            </template>
            <template v-else-if="draft.code === 105">
              <label>{{ t('eventcmd.speed') }}<input :value="numberParam(0,2)" type="number" min="1" @input="setParam(0, numberValue($event))" /></label>
              <label class="check"><input :checked="boolParam(1)" type="checkbox" @change="setParam(1, checkedValue($event))" />{{ t('eventcmd.disableFastForward') }}</label>
              <label class="full">{{ t('eventcmd.text') }}<textarea v-model="multiText" rows="7" /></label>
            </template>
            <label v-else-if="draft.code === 108" class="full">{{ t('eventcmd.comment') }}<textarea v-model="multiText" rows="7" /></label>
            <template v-else-if="draft.code === 205">
              <EventCommandFields :command="draft" :engine="currentEngine" :catalog="catalog" :load-image="loadImage" :map-id="mapId" :current-events="currentEvents" @change="touchCommand" />
              <div class="route-field"><span>{{ routeSummary }}</span><button type="button" class="editor-btn" @click="routeDialog?.open(routeParam)">{{ t('eventcmd.editRoute') }}</button></div>
            </template>
            <label v-else-if="draft.code === 355" class="full">{{ t('eventcmd.script') }}<textarea v-model="multiText" rows="11" spellcheck="false" /></label>
            <template v-else-if="draft.code === 356 || draft.code === 357">
              <div class="plugin-command-editor">
                <label>
                  {{ t('eventcmd.enabledPlugins') }}
                  <select :value="pluginCommandPlugin" @change="selectPluginForCommand">
                    <option value="">{{ t('eventcmd.allPlugins') }}</option>
                    <option v-for="plugin in enabledPluginEntries" :key="plugin.name" :value="plugin.name">{{ plugin.name }}</option>
                  </select>
                </label>
                <label>
                  {{ t('eventcmd.sourceHints') }}
                  <select :value="matchedPluginCommandHintKey" @change="applyPluginCommandHint">
                    <option value="">{{ t('eventcmd.selectHint') }}</option>
                    <option v-for="hint in visiblePluginCommandHints" :key="pluginCommandHintKey(hint)" :value="pluginCommandHintKey(hint)">
                      {{ hint.command }} · {{ hint.pluginName }}
                    </option>
                  </select>
                </label>
                <label v-if="draft.code === 356" class="full">
                  {{ t('eventcmd.pluginCommand') }}
                  <textarea :value="stringParam(0)" rows="5" spellcheck="false" @input="setParam(0,inputValue($event))" />
                </label>
                <template v-else>
                  <label class="full">
                    {{ t('eventcmd.pluginCommand') }}
                    <input :value="stringParam(2) || stringParam(1)" readonly />
                  </label>
                  <label v-for="argument in selectedMZPluginHint?.arguments || []" :key="argument.name" class="full plugin-command-argument">
                    <span>{{ argument.label || argument.name }}</span>
                    <PluginParameterInput
                      :field="argument"
                      :model-value="mzPluginArgument(argument.name)"
                      :catalog="catalog"
                      @update:model-value="setMZPluginArgument(argument, $event)"
                    />
                    <small v-if="argument.description">{{ argument.description }}</small>
                  </label>
                </template>
                <p class="form-note">{{ pluginCommandPreview }}</p>
                <div v-if="pluginCommandError" class="plugin-command-warning">{{ pluginCommandError }}</div>
                <div v-else-if="!visiblePluginCommandHints.length" class="plugin-command-warning">
                  {{ t('eventcmd.unsupported') }}
                </div>
                <div v-else class="plugin-command-hints">
                  <button
                    v-for="hint in visiblePluginCommandHints.slice(0, 6)"
                    :key="pluginCommandHintKey(hint)"
                    type="button"
                    @click="applyPluginCommandHintValue(hint)"
                  >
                    <strong>{{ hint.command }}</strong>
                    <small>{{ hint.evidence }}</small>
                  </button>
                </div>
              </div>
            </template>
            <EventCommandFields v-else-if="commandDefinition(draft.code,currentEngine)" :command="draft" :engine="currentEngine" :catalog="catalog" :load-image="loadImage" :map-id="mapId" :current-events="currentEvents" @change="touchCommand" />
            <p v-else class="form-note unsupported-command">
              {{ t('eventcmd.unsupportedEditor') }}
            </p>
          </div>
        </div>

        <footer v-if="!pickerOpen" class="editor-modal-footer">
          <button type="button" class="editor-btn" @click="close">{{ t('eventcmd.cancel') }}</button>
          <button type="button" class="editor-btn primary" @click="commit">{{ t('eventcmd.ok') }}</button>
        </footer>
      </section>
    </div>
  </teleport>
  <ImageAssetPickerDialog ref="imagePicker" :catalog="catalog" :load-image="loadImage" @commit="setTextFace" />
  <MoveRouteDialog ref="routeDialog" :preview-x="eventX" :preview-y="eventY" @commit="setRoute" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { RpgMakerEngine } from '@contract/types';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import { plugins as pluginApi, type EditorProjectCatalog, type ManagedPluginEntry, type PluginCommandArgument, type PluginCommandHint, type PluginParameterSchemaField } from '../../api/client';
import { useProjectStore } from '../../stores/project';
import { commandPages, applyCommandIndent, commandDefinition, commandTemplate, normalizeEventCommandParameters } from '../../composables/eventCommandCatalog';
import { clone, defaultMoveRoute, type MvCommand, type MvMoveRoute } from '../../composables/useEventEditor';
import { localizeCommandGroups, localizeCommandLabel } from '../../utils/eventCommandLocalization';
import { mvFaceSourceRect } from '../../utils/rmmvFace';
import EventCommandFields from './EventCommandFields.vue';
import ImageAssetPickerDialog from './ImageAssetPickerDialog.vue';
import MoveRouteDialog from './MoveRouteDialog.vue';
import PluginParameterInput from './PluginParameterInput.vue';
import type { EditorEventListItem } from './editorTypes';
const props = withDefaults(defineProps<{ mapId:number|null; catalog:EditorProjectCatalog|null; loadImage:(url:string)=>Promise<HTMLImageElement|null>; eventX?:number; eventY?:number; currentEvents?:EditorEventListItem[] }>(), { eventX: 0, eventY: 0 });
const emit = defineEmits<{ commit:[payload:{commands:MvCommand[];editSpan:number|null;insertSpan:number|null}] }>();
const projectStore = useProjectStore();
const { language, t } = useI18n();
const commandDialogZ = String(LAYER_Z.commandDialog);
const visible=ref(false),pickerOpen=ref(false),pickerPage=ref(1),draft=ref<MvCommand|null>(null),draftSpan=ref<MvCommand[]>([]),editSpan=ref<number|null>(null),insertSpan=ref<number|null>(null),insertIndent=ref(0),multiText=ref('');
const imagePicker=ref<InstanceType<typeof ImageAssetPickerDialog>>(),routeDialog=ref<InstanceType<typeof MoveRouteDialog>>(),facePreviewRef=ref<HTMLCanvasElement>();
const pickerSearchRef=ref<HTMLInputElement>(),pickerListRef=ref<HTMLElement>(),pickerQuery=ref(''),activePickerIndex=ref(0);
const pickerListId='event-command-picker-list';
const pluginCommandPlugins = ref<ManagedPluginEntry[]>([]);
const pluginCommandPlugin = ref('');
const pluginCommandError = ref('');
const pluginCommandLoading = ref(false);
const currentEngine=computed<RpgMakerEngine>(()=>projectStore.currentProjectInfo?.engine||'rpg-maker-mv');
const faceSize=computed(()=>Math.max(1,Number(props.catalog?.faceSize)||144));
const commandPageCategories=computed(()=>commandPages(currentEngine.value).map((groups,pageIndex)=>
  localizeCommandGroups(groups,language.value).map((category)=>({...category,page:pageIndex+1})),
));
const currentCategories=computed(()=>{
  const query=pickerQuery.value.trim().toLocaleLowerCase(language.value);
  const categories=query
    ? commandPageCategories.value.flat()
    : commandPageCategories.value[pickerPage.value-1]||[];
  if(!query)return categories;
  return categories.flatMap((category)=>{
    const groupMatches=category.group.toLocaleLowerCase(language.value).includes(query);
    const items=groupMatches?category.items:category.items.filter((item)=>item.label.toLocaleLowerCase(language.value).includes(query));
    return items.length?[{...category,items}]:[];
  });
});
const currentPickerItems=computed(()=>currentCategories.value.flatMap((category)=>category.items));
const activePickerItem=computed(()=>currentPickerItems.value[activePickerIndex.value]||null);
const activePickerCode=computed(()=>activePickerItem.value?.code??null);
const activePickerOptionId=computed(()=>activePickerItem.value?pickerOptionId(activePickerItem.value.code):'');
const dialogTitle=computed(()=>pickerOpen.value?t('eventcmd.title'):editSpan.value!=null?t('eventcmd.editTitle'):t('eventcmd.newTitle'));
const commandTitle=computed(()=>{
  if (!draft.value) return '';
  const definition = commandDefinition(draft.value.code,currentEngine.value);
  return definition ? localizeCommandLabel(definition, language.value) : t('eventcmd.unknownCommand', { code: draft.value.code });
});
const choicesText=computed(()=>((draft.value?.parameters[0] as string[])||[]).join('\n'));
const routeParam=computed<MvMoveRoute>(()=>(draft.value?.parameters[1] as MvMoveRoute)||defaultMoveRoute());
const routeSummary=computed(()=>t('eventcmd.routeSteps', { count: routeParam.value.list.filter((item)=>item.code!==0).length }));
const enabledPluginEntries=computed(()=>pluginCommandPlugins.value.filter((plugin)=>plugin.status&&plugin.fileExists&&plugin.name));
const visiblePluginCommandHints=computed(()=>enabledPluginEntries.value
  .filter((plugin)=>!pluginCommandPlugin.value||plugin.name===pluginCommandPlugin.value)
  .flatMap((plugin)=>plugin.commandHints||[])
  .filter((hint)=>currentEngine.value==='rpg-maker-mz'?hint.source==='mz-command-header':hint.source!=='mz-command-header'));
const currentPluginCommandText=computed(()=>String(draft.value?.parameters[draft.value?.code===357?1:0]||'').trim());
const currentPluginCommandToken=computed(()=>currentPluginCommandText.value.split(/\s+/).filter(Boolean)[0]||'');
const matchedPluginCommandHints=computed(()=>enabledPluginEntries.value
  .flatMap((plugin)=>plugin.commandHints||[])
  .filter((hint)=>hint.command.toLowerCase()===currentPluginCommandToken.value.toLowerCase())
  .filter((hint)=>draft.value?.code!==357||hint.source==='mz-command-header'&&hint.pluginName===String(draft.value.parameters[0]||'')));
const matchedPluginCommandHintKey=computed(()=>matchedPluginCommandHints.value[0]?pluginCommandHintKey(matchedPluginCommandHints.value[0]):'');
const selectedMZPluginHint=computed(()=>matchedPluginCommandHints.value.find((hint)=>hint.source==='mz-command-header')||null);
const currentMZPluginArguments=computed<Record<string,string>>(()=>{
  const value=draft.value?.parameters[3];
  if(!value||Array.isArray(value)||typeof value!=='object')return{};
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,entry])=>[key,String(entry??'')]));
});
const pluginCommandPreview=computed(()=>{
  if (pluginCommandLoading.value) return t('eventcmd.pluginLoading');
  const token = currentPluginCommandToken.value;
  if (!token) return t('eventcmd.pluginHint');
  if (matchedPluginCommandHints.value.length) {
    return t('eventcmd.pluginMatched', { token, plugins: matchedPluginCommandHints.value.map((hint)=>hint.pluginName).join(' / ') });
  }
  const enabled = enabledPluginEntries.value.find((plugin)=>plugin.name.toLowerCase()===token.toLowerCase());
  if (enabled) return t('eventcmd.pluginNoBranch', { name: enabled.name });
  return t('eventcmd.pluginNoMatch', { token });
});
watch(currentPickerItems,()=>{activePickerIndex.value=currentPickerItems.value.length?0:-1;});

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.commandDialog)) return;
  event.preventDefault();
  close();
}
onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

function openPicker(at:number, indent=0){pickerOpen.value=true;pickerPage.value=1;pickerQuery.value='';activePickerIndex.value=0;draft.value=null;draftSpan.value=[];insertSpan.value=at;insertIndent.value=indent;editSpan.value=null;visible.value=true;void nextTick(()=>pickerSearchRef.value?.focus());void loadPluginCommandMetadata();}
function openEditor(commands:MvCommand[],index:number){draftSpan.value=clone(commands);draft.value=draftSpan.value[0];if(draft.value)normalizeEventCommandParameters(draft.value,currentEngine.value);editSpan.value=index;insertSpan.value=null;insertIndent.value=draft.value?.indent||0;pickerOpen.value=false;syncMultiText();syncPluginCommandSelection();visible.value=true;void loadPluginCommandMetadata();if(draft.value?.code===101)void nextTick(paintFacePreview);}
function pick(kind:string){draftSpan.value=applyCommandIndent(commandTemplate(kind,props.mapId??1,currentEngine.value),insertIndent.value);draft.value=draftSpan.value[0];if(draft.value)normalizeEventCommandParameters(draft.value,currentEngine.value);pickerOpen.value=false;syncMultiText();syncPluginCommandSelection();if(draft.value?.code===356||draft.value?.code===357)void loadPluginCommandMetadata();if(draft.value?.code===101)void nextTick(paintFacePreview);}
function close(){visible.value=false;pickerOpen.value=false;pickerQuery.value='';draft.value=null;draftSpan.value=[];}
function selectPickerPage(page:number){pickerPage.value=page;pickerQuery.value='';}
function pickerOptionId(code:number){return `event-command-option-${code}`;}
function activatePickerItem(code:number){const index=currentPickerItems.value.findIndex((item)=>item.code===code);if(index>=0)activePickerIndex.value=index;}
function movePickerSelection(step:number,focusButton:boolean){
  const count=currentPickerItems.value.length;
  if(!count)return;
  activePickerIndex.value=(Math.max(0,activePickerIndex.value)+step+count)%count;
  void nextTick(()=>{
    const active=pickerListRef.value?.querySelector<HTMLElement>(`#${activePickerOptionId.value}`);
    active?.scrollIntoView({block:'nearest'});
    if(focusButton)active?.focus();
  });
}
function onPickerKeyDown(event:KeyboardEvent){
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    event.preventDefault();
    movePickerSelection(event.key==='ArrowDown'?1:-1,event.target!==pickerSearchRef.value);
    return;
  }
  if(event.key==='Enter'&&event.target===pickerSearchRef.value&&activePickerItem.value){
    event.preventDefault();
    pick(activePickerItem.value.kind);
  }
}
function commit(){if(!draft.value)return;emit('commit',{commands:buildSpan(),editSpan:editSpan.value,insertSpan:insertSpan.value});close();}
function buildSpan(){
  if(!draft.value)return[];
  if(draft.value.code===101)return [clone(draft.value),...splitText(401)];
  if(draft.value.code===105)return [clone(draft.value),...splitText(405)];
  if(draft.value.code===108)return splitText(108,408);
  if(draft.value.code===205)return [clone(draft.value),...routeParam.value.list.filter((step)=>step.code!==0).map((step)=>({code:505,indent:draft.value!.indent,parameters:[clone(step)]}))];
  if(draft.value.code===355)return splitText(355,655);
  if(draft.value.code===357)return [clone(draft.value),...Object.entries(currentMZPluginArguments.value).map(([name,value])=>({code:657,indent:draft.value!.indent,parameters:[`${name} = ${value}`]}))];
  if(draft.value.code===102&&editSpan.value==null)return buildChoiceBlock();
  return clone(draftSpan.value.length?draftSpan.value:[draft.value]);
}
function buildChoiceBlock(){
  const head=clone(draft.value!);
  const choices=(head.parameters[0] as string[])||[];
  return [head,...choices.map((choice,index)=>({code:402,indent:head.indent,parameters:[index,choice]})),{code:404,indent:head.indent,parameters:[]}];
}
function splitText(firstCode:number,nextCode=firstCode){const lines=multiText.value.split(/\r?\n/);return lines.map((line,index)=>({code:index?nextCode:firstCode,indent:draft.value?.indent||0,parameters:[line]}));}
function syncMultiText(){if(!draft.value)return;multiText.value=draft.value.code===101||draft.value.code===105?draftSpan.value.slice(1).map((item)=>String(item.parameters[0]||'')).join('\n'):draft.value.code===108||draft.value.code===355?draftSpan.value.map((item)=>String(item.parameters[0]||'')).join('\n'):String(draft.value.parameters[0]||'');}
function touchCommand(){if(draft.value)normalizeEventCommandParameters(draft.value,currentEngine.value);}
function setParam(index:number,value:unknown){if(draft.value){draft.value.parameters[index]=value;if((draft.value.code===356&&index===0)||(draft.value.code===357&&(index===0||index===1)))syncPluginCommandSelection();touchCommand();}}
function numberParam(index:number,fallback=0){return Number(draft.value?.parameters[index]??fallback);}
function stringParam(index:number,fallback=''){return String(draft.value?.parameters[index]??fallback);}
function boolParam(index:number,fallback=false){return Boolean(draft.value?.parameters[index]??fallback);}
function setChoices(event:Event){setParam(0,inputValue(event).split('\n').map((value)=>value.trim()).filter(Boolean));}
function openTextFacePicker(){imagePicker.value?.open({asset:'faces',mode:'face',title:t('eventcmd.chooseFace'),name:stringParam(0),index:numberParam(1)});}
function setTextFace(selection:{name:string;index:number}){setParam(0,selection.name);setParam(1,selection.name?selection.index:0);void nextTick(paintFacePreview);}
async function paintFacePreview(){const el=facePreviewRef.value;if(!el)return;const w=el.width,h=el.height,ctx=el.getContext('2d')!;ctx.clearRect(0,0,w,h);ctx.imageSmoothingEnabled=false;const faceName=stringParam(0);if(!faceName){ctx.fillStyle='#e0ddd6';ctx.fillRect(0,0,w,h);return;}const asset=props.catalog?.assets.faces.find(e=>e.name===faceName);if(!asset){ctx.fillStyle='#e0ddd6';ctx.fillRect(0,0,w,h);return;}const img=await props.loadImage(asset.url);if(!img){ctx.fillStyle='#e0ddd6';ctx.fillRect(0,0,w,h);return;}const source=mvFaceSourceRect(numberParam(1),faceSize.value);ctx.drawImage(img,source.sx,source.sy,source.sw,source.sh,0,0,w,h);}
function setRoute(route:MvMoveRoute){setParam(1,route);}
function inputValue(event:Event){return(event.target as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement).value;}
function numberValue(event:Event){return Number(inputValue(event));}
function checkedValue(event:Event){return(event.target as HTMLInputElement).checked;}
async function loadPluginCommandMetadata(){
  if (!projectStore.currentProject||pluginCommandLoading.value) return;
  pluginCommandLoading.value=true;
  pluginCommandError.value='';
  try {
    const config = await pluginApi.read(projectStore.currentProject);
    pluginCommandPlugins.value = config.plugins;
    syncPluginCommandSelection();
  } catch (error) {
    pluginCommandError.value=t('eventcmd.pluginError', { error: (error as Error).message });
    pluginCommandPlugins.value=[];
  } finally {
    pluginCommandLoading.value=false;
  }
}
function syncPluginCommandSelection(){
  if(draft.value?.code===357){
    const pluginName=String(draft.value.parameters[0]||'');
    if(pluginName)pluginCommandPlugin.value=pluginName;
    return;
  }
  const token = currentPluginCommandToken.value.toLowerCase();
  if (!token) return;
  const hinted = enabledPluginEntries.value.find((plugin)=>plugin.commandHints?.some((hint)=>hint.command.toLowerCase()===token));
  if (hinted) { pluginCommandPlugin.value=hinted.name; return; }
  const named = enabledPluginEntries.value.find((plugin)=>plugin.name.toLowerCase()===token);
  if (named) pluginCommandPlugin.value=named.name;
}
function selectPluginForCommand(event:Event){
  const name=inputValue(event);
  pluginCommandPlugin.value=name;
  if (!draft.value||!name) return;
  if (draft.value.code===356&&!currentPluginCommandText.value) setParam(0,name);
  if (draft.value.code===357) {
    setParam(0,name);
    setParam(1,'');
    setParam(2,'');
    setParam(3,{});
  }
}
function pluginCommandHintKey(hint:PluginCommandHint){return `${hint.pluginName}\u0000${hint.source}\u0000${hint.command}`;}
function applyPluginCommandHint(event:Event){
  const key=inputValue(event);
  const hint=visiblePluginCommandHints.value.find((item)=>pluginCommandHintKey(item)===key);
  if (hint) applyPluginCommandHintValue(hint);
}
function applyPluginCommandHintValue(hint:PluginCommandHint){
  pluginCommandPlugin.value=hint.pluginName;
  if(draft.value?.code===357){
    const existing=currentMZPluginArguments.value;
    const args=Object.fromEntries((hint.arguments||[]).map((argument)=>[argument.name,existing[argument.name]??argument.defaultValue??'']));
    draft.value.parameters=[hint.pluginName,hint.command,hint.displayName||hint.command,args];
    touchCommand();
    return;
  }
  const args=currentPluginCommandText.value.split(/\s+/).filter(Boolean).slice(1).join(' ');
  setParam(0,args?`${hint.command} ${args}`:hint.command);
}
function mzPluginArgument(name:string){return currentMZPluginArguments.value[name]??'';}
function setMZPluginArgument(argument:PluginCommandArgument,value:unknown){
  if(!draft.value||draft.value.code!==357)return;
  draft.value.parameters[3]={...currentMZPluginArguments.value,[argument.name]:serializePluginArgumentValue(argument,value)};
  touchCommand();
}
function serializePluginArgumentValue(field:PluginParameterSchemaField,value:unknown):string{
  if(field.kind==='boolean')return value===true||['true','on','1'].includes(String(value).toLowerCase())?'true':'false';
  if(field.kind==='location')return typeof value==='string'?value:JSON.stringify(value??{mapId:0,x:0,y:0});
  if(field.kind==='struct'){
    if(typeof value==='string')return value;
    const source=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
    return JSON.stringify(Object.fromEntries((field.fields||[]).map((child)=>[child.key,serializePluginArgumentValue(child,source[child.key])] )));
  }
  if(field.kind==='array'){
    if(typeof value==='string')return value;
    const values=Array.isArray(value)?value:[];
    return JSON.stringify(values.map((entry)=>field.item?serializePluginArgumentValue(field.item,entry):String(entry??'')));
  }
  return String(value??'');
}
defineExpose({openPicker,openEditor});
</script>

<style scoped>
.ev-modal-overlay{z-index:v-bind(commandDialogZ);background:transparent}.cmd-dialog{width:min(620px,calc(100vw - 32px));height:auto;max-height:min(560px,calc(100vh - 32px))}.picker-shell{min-height:0;display:flex;flex-direction:column}.command-page-tabs{padding:8px 12px 0}.command-page-tabs button{min-width:36px}.picker-search{display:grid;gap:5px;padding:8px 12px;color:var(--app-ink-soft);font-size:12px}.picker-search input{width:100%;min-height:32px}.picker{min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:8px;padding:0 12px 12px;overflow:auto}.picker-group{padding:7px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg-soft)}.picker h4{margin:0 0 5px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--app-ink);font-size:12px}.picker h4 small{color:var(--app-ink-muted);font-size:10px;font-weight:500}.picker-group div{display:grid;gap:3px}.picker button{min-height:28px;padding:3px 8px;border:1px solid var(--app-border-strong);border-radius:2px;background:linear-gradient(var(--app-bg),var(--app-bg-sunken));color:var(--app-ink);cursor:pointer;font-size:12px;text-align:left}.picker button:hover,.picker button.active{border-color:var(--app-accent);background:var(--app-accent-soft)}.picker button:focus-visible{outline:2px solid var(--app-accent);outline-offset:1px}.picker-empty{grid-column:1 / -1;margin:16px 0;padding:16px;border:1px dashed var(--app-border);border-radius:var(--app-radius-sm);color:var(--app-ink-muted);font-size:12px;text-align:center}.editor-body{min-height:0;padding:12px;overflow:auto}.editor-heading{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--app-border)}.fields{display:flex;flex-wrap:wrap;gap:8px}.fields>label{min-width:145px;display:grid;gap:4px;color:var(--app-ink-soft);font-size:12px}.fields .full{width:100%}input:not([type=checkbox]),select,textarea{min-width:0;padding:5px 6px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg);color:var(--app-ink);font-size:13px}textarea{font-family:var(--app-font-mono);resize:vertical}.inline,.route-field{display:flex;align-items:center;gap:5px}.inline input{min-width:0;flex:1}.route-field{min-width:230px;justify-content:space-between;color:var(--app-ink-muted);font-size:12px}.check{display:flex!important;grid-template-columns:auto 1fr!important;align-items:center}.form-note{width:100%;margin:0;color:var(--app-ink-muted);font-size:12px;line-height:1.5}.unsupported-command{padding:10px;border:1px dashed var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg-soft)}
.plugin-command-editor{width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.plugin-command-editor label{min-width:0;display:grid;gap:4px;color:var(--app-ink-soft);font-size:12px}.plugin-command-editor .full{grid-column:1 / -1}.plugin-command-editor textarea{min-height:96px}.plugin-command-warning{grid-column:1 / -1;padding:8px 10px;border-radius:var(--app-radius-sm);background:var(--app-warn-soft);color:var(--app-warn);font-size:12px;line-height:1.45}.plugin-command-hints{grid-column:1 / -1;display:grid;gap:5px}.plugin-command-hints button{display:grid;gap:3px;padding:7px 9px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg-soft);color:var(--app-ink);font:inherit;text-align:left;cursor:pointer}.plugin-command-hints button:hover{border-color:var(--app-accent);background:var(--app-accent-soft)}.plugin-command-hints strong{font-size:12px}.plugin-command-hints small{overflow:hidden;color:var(--app-ink-muted);font-family:var(--app-font-mono);font-size:10px;text-overflow:ellipsis;white-space:nowrap}
.plugin-command-argument small{color:var(--app-ink-muted);font-size:11px;line-height:1.35}
.text-cmd-layout{width:100%;display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start}.text-cmd-face{display:flex;flex-direction:column;align-items:center;gap:6px}.face-preview{width:144px;height:144px;border:1px solid var(--app-border-strong);border-radius:var(--app-radius-sm);cursor:pointer;image-rendering:pixelated;background:#e0ddd6}.text-cmd-text{display:grid;gap:4px;color:var(--app-ink-soft);font-size:12px}.text-cmd-text textarea{min-height:144px}.text-cmd-options{width:100%;display:flex;gap:12px;margin-top:4px}
</style>
