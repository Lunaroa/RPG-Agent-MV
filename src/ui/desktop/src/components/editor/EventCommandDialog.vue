<template>
  <teleport to="body">
    <div v-if="visible" class="ev-modal-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.commandDialog" @mousedown.self="close">
      <section class="cmd-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="command-dialog-title">
        <header class="editor-modal-header">
          <strong id="command-dialog-title" class="editor-modal-title">{{ dialogTitle }}</strong>
          <button type="button" class="editor-modal-close" aria-label="关闭指令编辑器" title="关闭" @click="close">×</button>
        </header>

        <template v-if="pickerOpen">
          <nav class="command-page-tabs editor-tab-strip" aria-label="事件指令页签">
            <button v-for="page in 3" :key="page" type="button" :class="{ active: pickerPage === page }" @click="pickerPage = page">{{ page }}</button>
          </nav>
          <div class="picker">
            <section v-for="category in currentCategories" :key="category.group" class="picker-group">
              <h4>{{ category.group }}</h4>
              <div>
                <button v-for="item in category.items" :key="item.code" type="button" @click="pick(item.kind)">{{ item.label }}...</button>
              </div>
            </section>
          </div>
        </template>

        <div v-else-if="draft" class="editor-body">
          <div class="editor-heading">
            <strong>{{ commandDefinition(draft.code)?.label || `未知指令 ${draft.code}` }}</strong>
          </div>

          <div class="fields">
            <template v-if="draft.code === 101">
              <div class="text-cmd-layout">
                <div class="text-cmd-face">
                  <canvas ref="facePreviewRef" class="face-preview" width="144" height="144" @click="openTextFacePicker" />
                  <button type="button" class="editor-btn" @click="openTextFacePicker">选择...</button>
                </div>
                <label class="text-cmd-text">文本<textarea v-model="multiText" rows="5" /></label>
              </div>
              <div class="text-cmd-options">
                <label>背景<select :value="numberParam(2)" @change="setParam(2, numberValue($event))"><option :value="0">窗口</option><option :value="1">暗淡</option><option :value="2">透明</option></select></label>
                <label>位置<select :value="numberParam(3,2)" @change="setParam(3, numberValue($event))"><option :value="0">顶部</option><option :value="1">中部</option><option :value="2">底部</option></select></label>
              </div>
            </template>
            <template v-else-if="draft.code === 102">
              <label class="full">选项（每行一个）<textarea :value="choicesText" rows="6" @input="setChoices" /></label>
              <p class="form-note">新增时会自动建立对应分支；编辑已有选项时保留现有分支内容。</p>
            </template>
            <template v-else-if="draft.code === 105">
              <label>速度<input :value="numberParam(0,2)" type="number" min="1" @input="setParam(0, numberValue($event))" /></label>
              <label class="check"><input :checked="boolParam(1)" type="checkbox" @change="setParam(1, checkedValue($event))" />禁止快进</label>
              <label class="full">文本<textarea v-model="multiText" rows="7" /></label>
            </template>
            <label v-else-if="draft.code === 108" class="full">注释<textarea v-model="multiText" rows="7" /></label>
            <template v-else-if="draft.code === 205">
              <label>目标<input :value="numberParam(0)" type="number" @input="setParam(0,numberValue($event))" /></label>
              <div class="route-field"><span>{{ routeSummary }}</span><button type="button" class="editor-btn" @click="routeDialog?.open(routeParam)">编辑路线...</button></div>
            </template>
            <label v-else-if="draft.code === 355" class="full">脚本<textarea v-model="multiText" rows="11" spellcheck="false" /></label>
            <template v-else-if="draft.code === 356">
              <div class="plugin-command-editor">
                <label>
                  已启用插件
                  <select :value="pluginCommandPlugin" @change="selectPluginForCommand">
                    <option value="">全部插件</option>
                    <option v-for="plugin in enabledPluginEntries" :key="plugin.name" :value="plugin.name">{{ plugin.name }}</option>
                  </select>
                </label>
                <label>
                  源码命令提示
                  <select :value="matchedPluginCommandHintKey" @change="applyPluginCommandHint">
                    <option value="">选择已识别命令</option>
                    <option v-for="hint in visiblePluginCommandHints" :key="pluginCommandHintKey(hint)" :value="pluginCommandHintKey(hint)">
                      {{ hint.command }} · {{ hint.pluginName }}
                    </option>
                  </select>
                </label>
                <label class="full">
                  插件命令
                  <textarea :value="stringParam(0)" rows="5" spellcheck="false" @input="setParam(0,inputValue($event))" />
                </label>
                <p class="form-note">{{ pluginCommandPreview }}</p>
                <div v-if="pluginCommandError" class="plugin-command-warning">{{ pluginCommandError }}</div>
                <div v-else-if="!visiblePluginCommandHints.length" class="plugin-command-warning">
                  当前范围没有从 MV `pluginCommand(command, args)` 源码中识别到命令分支；仍可手写原始命令。
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
            <EventCommandFields v-else-if="commandDefinition(draft.code)" :command="draft" :catalog="catalog" :load-image="loadImage" @change="touchCommand" />
            <p v-else class="form-note unsupported-command">
              这个指令还没有图形化编辑器。可以先保留原内容；需要修改时应补对应的中文控件，而不是直接编辑数据结构。
            </p>
          </div>
        </div>

        <footer v-if="!pickerOpen" class="editor-modal-footer">
          <button type="button" class="editor-btn" @click="close">取消</button>
          <button type="button" class="editor-btn primary" @click="commit">确定</button>
        </footer>
      </section>
    </div>
  </teleport>
  <ImageAssetPickerDialog ref="imagePicker" :catalog="catalog" :load-image="loadImage" @commit="setTextFace" />
  <MoveRouteDialog ref="routeDialog" @commit="setRoute" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { LAYER_Z } from '../../constants/layerZIndex';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import { plugins as pluginApi, type EditorProjectCatalog, type ManagedPluginEntry, type PluginCommandHint } from '../../api/client';
import { useProjectStore } from '../../stores/project';
import { COMMAND_PAGES, applyCommandIndent, commandDefinition, commandTemplate, normalizeEventCommandParameters } from '../../composables/eventCommandCatalog';
import { clone, defaultMoveRoute, type MvCommand, type MvMoveRoute } from '../../composables/useEventEditor';
import { mvFaceSourceRect } from '../../utils/rmmvFace';
import EventCommandFields from './EventCommandFields.vue';
import ImageAssetPickerDialog from './ImageAssetPickerDialog.vue';
import MoveRouteDialog from './MoveRouteDialog.vue';

const props = defineProps<{ mapId:number|null; catalog:EditorProjectCatalog|null; loadImage:(url:string)=>Promise<HTMLImageElement|null> }>();
const emit = defineEmits<{ commit:[payload:{commands:MvCommand[];editSpan:number|null;insertSpan:number|null}] }>();
const projectStore = useProjectStore();
const commandDialogZ = String(LAYER_Z.commandDialog);
const visible=ref(false),pickerOpen=ref(false),pickerPage=ref(1),draft=ref<MvCommand|null>(null),draftSpan=ref<MvCommand[]>([]),editSpan=ref<number|null>(null),insertSpan=ref<number|null>(null),insertIndent=ref(0),multiText=ref('');
const imagePicker=ref<InstanceType<typeof ImageAssetPickerDialog>>(),routeDialog=ref<InstanceType<typeof MoveRouteDialog>>(),facePreviewRef=ref<HTMLCanvasElement>();
const pluginCommandPlugins = ref<ManagedPluginEntry[]>([]);
const pluginCommandPlugin = ref('');
const pluginCommandError = ref('');
const pluginCommandLoading = ref(false);
const currentCategories=computed(()=>COMMAND_PAGES[pickerPage.value-1]||[]);
const dialogTitle=computed(()=>pickerOpen.value?'事件指令':editSpan.value!=null?'编辑指令':'新建指令');
const choicesText=computed(()=>((draft.value?.parameters[0] as string[])||[]).join('\n'));
const routeParam=computed<MvMoveRoute>(()=>(draft.value?.parameters[1] as MvMoveRoute)||defaultMoveRoute());
const routeSummary=computed(()=>`${routeParam.value.list.filter((item)=>item.code!==0).length} 个步骤`);
const enabledPluginEntries=computed(()=>pluginCommandPlugins.value.filter((plugin)=>plugin.status&&plugin.fileExists&&plugin.name));
const visiblePluginCommandHints=computed(()=>enabledPluginEntries.value
  .filter((plugin)=>!pluginCommandPlugin.value||plugin.name===pluginCommandPlugin.value)
  .flatMap((plugin)=>plugin.commandHints||[]));
const currentPluginCommandText=computed(()=>String(draft.value?.parameters[0]||'').trim());
const currentPluginCommandToken=computed(()=>currentPluginCommandText.value.split(/\s+/).filter(Boolean)[0]||'');
const matchedPluginCommandHints=computed(()=>enabledPluginEntries.value
  .flatMap((plugin)=>plugin.commandHints||[])
  .filter((hint)=>hint.command.toLowerCase()===currentPluginCommandToken.value.toLowerCase()));
const matchedPluginCommandHintKey=computed(()=>matchedPluginCommandHints.value[0]?pluginCommandHintKey(matchedPluginCommandHints.value[0]):'');
const pluginCommandPreview=computed(()=>{
  if (pluginCommandLoading.value) return '正在读取插件命令提示...';
  const token = currentPluginCommandToken.value;
  if (!token) return 'MV 插件命令会写入 code 356 的单行文本；请选择提示或手写命令。';
  if (matchedPluginCommandHints.value.length) {
    return `已匹配源码命令 ${token}：${matchedPluginCommandHints.value.map((hint)=>hint.pluginName).join(' / ')}`;
  }
  const enabled = enabledPluginEntries.value.find((plugin)=>plugin.name.toLowerCase()===token.toLowerCase());
  if (enabled) return `起手词匹配已启用插件 ${enabled.name}，但源码里没有识别到明确 command 分支。`;
  return `未匹配已启用插件或已识别命令：${token}`;
});

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.commandDialog)) return;
  event.preventDefault();
  close();
}
onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

function openPicker(at:number, indent=0){pickerOpen.value=true;pickerPage.value=1;draft.value=null;draftSpan.value=[];insertSpan.value=at;insertIndent.value=indent;editSpan.value=null;visible.value=true;void loadPluginCommandMetadata();}
function openEditor(commands:MvCommand[],index:number){draftSpan.value=clone(commands);draft.value=draftSpan.value[0];if(draft.value)normalizeEventCommandParameters(draft.value);editSpan.value=index;insertSpan.value=null;insertIndent.value=draft.value?.indent||0;pickerOpen.value=false;syncMultiText();syncPluginCommandSelection();visible.value=true;void loadPluginCommandMetadata();if(draft.value?.code===101)void nextTick(paintFacePreview);}
function pick(kind:string){draftSpan.value=applyCommandIndent(commandTemplate(kind,props.mapId??1),insertIndent.value);draft.value=draftSpan.value[0];if(draft.value)normalizeEventCommandParameters(draft.value);pickerOpen.value=false;syncMultiText();syncPluginCommandSelection();if(draft.value?.code===356)void loadPluginCommandMetadata();if(draft.value?.code===101)void nextTick(paintFacePreview);}
function close(){visible.value=false;pickerOpen.value=false;draft.value=null;draftSpan.value=[];}
function commit(){if(!draft.value)return;emit('commit',{commands:buildSpan(),editSpan:editSpan.value,insertSpan:insertSpan.value});close();}
function buildSpan(){
  if(!draft.value)return[];
  if(draft.value.code===101)return [clone(draft.value),...splitText(401)];
  if(draft.value.code===105)return [clone(draft.value),...splitText(405)];
  if(draft.value.code===108)return splitText(108,408);
  if(draft.value.code===205)return [clone(draft.value),...routeParam.value.list.filter((step)=>step.code!==0).map((step)=>({code:505,indent:draft.value!.indent,parameters:[clone(step)]}))];
  if(draft.value.code===355)return splitText(355,655);
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
function touchCommand(){if(draft.value)normalizeEventCommandParameters(draft.value);}
function setParam(index:number,value:unknown){if(draft.value){draft.value.parameters[index]=value;if(draft.value.code===356&&index===0)syncPluginCommandSelection();touchCommand();}}
function numberParam(index:number,fallback=0){return Number(draft.value?.parameters[index]??fallback);}
function stringParam(index:number,fallback=''){return String(draft.value?.parameters[index]??fallback);}
function boolParam(index:number,fallback=false){return Boolean(draft.value?.parameters[index]??fallback);}
function setChoices(event:Event){setParam(0,inputValue(event).split('\n').map((value)=>value.trim()).filter(Boolean));}
function openTextFacePicker(){imagePicker.value?.open({asset:'faces',mode:'face',title:'选择脸图',name:stringParam(0),index:numberParam(1)});}
function setTextFace(selection:{name:string;index:number}){setParam(0,selection.name);setParam(1,selection.name?selection.index:0);void nextTick(paintFacePreview);}
async function paintFacePreview(){const el=facePreviewRef.value;if(!el)return;const w=el.width,h=el.height,ctx=el.getContext('2d')!;ctx.clearRect(0,0,w,h);ctx.imageSmoothingEnabled=false;const faceName=stringParam(0);if(!faceName){ctx.fillStyle='#e0ddd6';ctx.fillRect(0,0,w,h);return;}const asset=props.catalog?.assets.faces.find(e=>e.name===faceName);if(!asset){ctx.fillStyle='#e0ddd6';ctx.fillRect(0,0,w,h);return;}const img=await props.loadImage(asset.url);if(!img){ctx.fillStyle='#e0ddd6';ctx.fillRect(0,0,w,h);return;}const source=mvFaceSourceRect(numberParam(1));ctx.drawImage(img,source.sx,source.sy,source.sw,source.sh,0,0,w,h);}
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
    pluginCommandError.value=`插件命令提示读取失败：${(error as Error).message}`;
    pluginCommandPlugins.value=[];
  } finally {
    pluginCommandLoading.value=false;
  }
}
function syncPluginCommandSelection(){
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
  if (!draft.value||draft.value.code!==356||currentPluginCommandText.value||!name) return;
  setParam(0,name);
}
function pluginCommandHintKey(hint:PluginCommandHint){return `${hint.pluginName}\u0000${hint.source}\u0000${hint.command}`;}
function applyPluginCommandHint(event:Event){
  const key=inputValue(event);
  const hint=visiblePluginCommandHints.value.find((item)=>pluginCommandHintKey(item)===key);
  if (hint) applyPluginCommandHintValue(hint);
}
function applyPluginCommandHintValue(hint:PluginCommandHint){
  pluginCommandPlugin.value=hint.pluginName;
  const args=currentPluginCommandText.value.split(/\s+/).filter(Boolean).slice(1).join(' ');
  setParam(0,args?`${hint.command} ${args}`:hint.command);
}
defineExpose({openPicker,openEditor});
</script>

<style scoped>
.ev-modal-overlay{z-index:v-bind(commandDialogZ);background:transparent}.cmd-dialog{width:min(520px,calc(100vw - 32px));height:auto;max-height:min(500px,calc(100vh - 32px))}.command-page-tabs{padding:8px 12px 0}.command-page-tabs button{min-width:36px}.picker{min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:8px 12px 12px;overflow:auto}.picker-group{padding:7px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg-soft)}.picker h4{margin:0 0 5px;color:var(--app-ink);font-size:12px}.picker-group div{display:grid;gap:3px}.picker button{min-height:24px;padding:0 8px;border:1px solid var(--app-border-strong);border-radius:2px;background:linear-gradient(var(--app-bg),var(--app-bg-sunken));color:var(--app-ink);cursor:pointer;font-size:12px;text-align:center}.picker button:hover{border-color:var(--app-accent);background:var(--app-accent-soft)}.editor-body{min-height:0;padding:12px;overflow:auto}.editor-heading{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--app-border)}.fields{display:flex;flex-wrap:wrap;gap:8px}.fields>label{min-width:145px;display:grid;gap:4px;color:var(--app-ink-soft);font-size:12px}.fields .full{width:100%}input:not([type=checkbox]),select,textarea{min-width:0;padding:5px 6px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg);color:var(--app-ink);font-size:13px}textarea{font-family:var(--app-font-mono);resize:vertical}.inline,.route-field{display:flex;align-items:center;gap:5px}.inline input{min-width:0;flex:1}.route-field{min-width:230px;justify-content:space-between;color:var(--app-ink-muted);font-size:12px}.check{display:flex!important;grid-template-columns:auto 1fr!important;align-items:center}.form-note{width:100%;margin:0;color:var(--app-ink-muted);font-size:12px;line-height:1.5}.unsupported-command{padding:10px;border:1px dashed var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg-soft)}
.plugin-command-editor{width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.plugin-command-editor label{min-width:0;display:grid;gap:4px;color:var(--app-ink-soft);font-size:12px}.plugin-command-editor .full{grid-column:1 / -1}.plugin-command-editor textarea{min-height:96px}.plugin-command-warning{grid-column:1 / -1;padding:8px 10px;border-radius:var(--app-radius-sm);background:var(--app-warn-soft);color:var(--app-warn);font-size:12px;line-height:1.45}.plugin-command-hints{grid-column:1 / -1;display:grid;gap:5px}.plugin-command-hints button{display:grid;gap:3px;padding:7px 9px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg-soft);color:var(--app-ink);font:inherit;text-align:left;cursor:pointer}.plugin-command-hints button:hover{border-color:var(--app-accent);background:var(--app-accent-soft)}.plugin-command-hints strong{font-size:12px}.plugin-command-hints small{overflow:hidden;color:var(--app-ink-muted);font-family:var(--app-font-mono);font-size:10px;text-overflow:ellipsis;white-space:nowrap}
.text-cmd-layout{width:100%;display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start}.text-cmd-face{display:flex;flex-direction:column;align-items:center;gap:6px}.face-preview{width:144px;height:144px;border:1px solid var(--app-border-strong);border-radius:var(--app-radius-sm);cursor:pointer;image-rendering:pixelated;background:#e0ddd6}.text-cmd-text{display:grid;gap:4px;color:var(--app-ink-soft);font-size:12px}.text-cmd-text textarea{min-height:144px}.text-cmd-options{width:100%;display:flex;gap:12px;margin-top:4px}
</style>
