<template>
  <teleport to="body">
    <div v-if="visible" class="ev-modal-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.commandDialog" @mousedown.self="close">
      <section
        ref="dialogShellRef"
        class="cmd-dialog editor-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-dialog-title"
        :style="dialogStyle"
      >
        <header class="editor-modal-header">
          <strong id="command-dialog-title" class="editor-modal-title">{{ dialogTitle }}</strong>
          <button type="button" class="editor-modal-close" :aria-label="t('eventcmd.closeEditor')" :title="t('eventcmd.close')" @click="close">×</button>
        </header>

        <div v-if="pickerOpen" class="picker-shell" @keydown="onPickerKeyDown">
          <div class="picker-modebar">
            <nav v-if="pickerViewMode === 'paged'" class="command-page-tabs editor-tab-strip" :aria-label="t('eventcmd.pages')">
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
            <div v-else class="picker-modebar-spacer" aria-hidden="true" />
            <div class="picker-view-toggle editor-tab-strip" role="group" :aria-label="t('eventcmd.viewMode')">
              <button type="button" :class="{ active: pickerViewMode === 'paged' }" :aria-pressed="pickerViewMode === 'paged'" @click="setPickerViewMode('paged')">{{ t('eventcmd.viewPaged') }}</button>
              <button type="button" :class="{ active: pickerViewMode === 'table' }" :aria-pressed="pickerViewMode === 'table'" @click="setPickerViewMode('table')">{{ t('eventcmd.viewTable') }}</button>
            </div>
          </div>
          <label class="picker-search">
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
          <div :id="pickerListId"
            ref="pickerListRef"
            class="picker"
            :class="{ 'picker--table': pickerViewMode === 'table' }" role="listbox" :aria-label="t('eventcmd.commandList')"
            :style="{
              columns: pickerViewMode === 'table' ? '6' : '2'
            }"
          >
            <section
              v-for="category in currentCategories"
              :key="`${category.page}:${category.group}`"
              class="picker-group"
              role="group"
              :aria-label="category.group"
              :style="{
                gridRow: category.group == '角色' ? 'span 2' : ''
              }"
            >
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

        <div v-else-if="draft" class="editor-body" style="overflow: auto;">
          <div class="fields">
            <template v-if="draft.code === 101">
              <div class="text-cmd-layout">
                <div class="text-cmd-face">
                  <span>{{ t('eventcmd.face') }}</span>
                  <canvas ref="facePreviewRef" class="face-preview" :width="faceSize" :height="faceSize" @click="openTextFacePicker" />
                  <!-- <button type="button" class="editor-btn" @click="openTextFacePicker">{{ t('eventcmd.choose') }}</button> -->
                </div>
                <label class="text-cmd-text">{{ t('eventcmd.text') }}<span ref="textInputWrapRef" class="text-cmd-input-wrap"><textarea ref="textAreaRef" v-model="multiText" rows="5" @input="scheduleTextGuideMeasure" /><span class="text-guide-line" :style="{ left: `${textGuideLeft}px` }" aria-hidden="true" /></span></label>
              </div>
              <div class="text-cmd-options">
                <label v-if="currentEngine === 'rpg-maker-mz'">
                  <span class="text-cmd-label">{{ t('eventcmd.speakerName') }}</span>
                  <input :value="stringParam(4)" @input="setParam(4,inputValue($event))" /></label>
                <label>
                  <span class="text-cmd-label">{{ t('eventcmd.background') }}</span>
                  <select :value="numberParam(2)" @change="setParam(2, numberValue($event))">
                    <option :value="0">{{ t('eventcmd.bgWindow') }}</option>
                    <option :value="1">{{ t('eventcmd.bgDim') }}</option><option :value="2">{{ t('eventcmd.bgTransparent') }}</option>
                  </select>
                </label>
                <label>
                  <span class="text-cmd-label">{{ t('eventcmd.windowPosition') }}</span>
                  <select :value="numberParam(3,2)" @change="setParam(3, numberValue($event))">
                    <option :value="0">{{ t('eventcmd.posTop') }}</option>
                    <option :value="1">{{ t('eventcmd.posMiddle') }}</option><option :value="2">{{ t('eventcmd.posBottom') }}</option>
                  </select>
                </label>
                <button type="button" class="editor-btn text-cmd-preview" @click="openMessagePreview">{{ t('eventcmd.preview') }}</button>
              </div>
              <label class="check text-cmd-batch"><input v-model="batchInput" type="checkbox" />{{ t('eventcmd.batchEntry') }}</label>
            </template>
            <template v-else-if="draft.code === 102">
              <div class="choice-cmd-layout">
                <div class="choice-cmd-list">
                  <label class="choice-cmd-text">
                    <span class="choice-cmd-title">{{ t('eventcmd.choicesTitle') }}</span>
                    <textarea v-model="choiceText" rows="8" @input="scheduleChoiceValidation" />
                    <small class="choice-cmd-hint">{{ t('eventcmd.choiceInputHint') }}</small>
                  </label>
                  <p v-if="choiceError" class="choice-cmd-warning" role="alert">{{ choiceError }}</p>
                </div>
                <div class="choice-cmd-side">
                  <label>{{ t('eventcmd.background') }}<select :value="numberParam(4)" @change="setParam(4, numberValue($event))"><option :value="0">{{ t('eventcmd.bgWindow') }}</option><option :value="1">{{ t('eventcmd.bgDim') }}</option><option :value="2">{{ t('eventcmd.bgTransparent') }}</option></select></label>
                  <label>{{ t('eventcmd.windowPosition') }}<select :value="numberParam(3,2)" @change="setParam(3, numberValue($event))"><option :value="0">{{ t('eventcmd.posLeft') }}</option><option :value="1">{{ t('eventcmd.posMiddle') }}</option><option :value="2">{{ t('eventcmd.posRight') }}</option></select></label>
                  <label>{{ t('eventcmd.defaultChoice') }}<select :value="rawChoiceParam(2, -1)" @change="setParam(2, numberValue($event))"><option v-if="invalidChoiceDefault" :value="rawChoiceParam(2)">{{ t('eventcmd.choiceInvalid', { index: String(rawChoiceParam(2)) }) }}</option><option :value="-1">{{ t('eventcmd.choiceNone') }}</option><option v-for="option in choiceItemOptions" :key="`default-${option.value}`" :value="option.value">{{ option.label }}</option></select></label>
                  <label>{{ t('eventcmd.cancelChoice') }}<select :value="rawChoiceParam(1, -1)" @change="setParam(1, numberValue($event))"><option v-if="invalidChoiceCancel" :value="rawChoiceParam(1)">{{ t('eventcmd.choiceInvalid', { index: String(rawChoiceParam(1)) }) }}</option><option :value="-2">{{ t('eventcmd.choiceBranch') }}</option><option :value="-1">{{ t('eventcmd.choiceDisallow') }}</option><option v-for="option in choiceItemOptions" :key="`cancel-${option.value}`" :value="option.value">{{ option.label }}</option></select></label>
                </div>
              </div>
            </template>
            <template v-else-if="draft.code === 103 || draft.code === 104">
              <div class="var-cmd-field">
                <span class="text-cmd-label">{{ t('eventcmd.variable') }}</span>
                <div class="var-cmd-row">
                  <input :value="variableDisplay(numberParam(0,1))" readonly @click="openVariableSelector(0)" />
                  <button type="button" class="editor-btn" @click="openVariableSelector(0)">…</button>
                </div>
              </div>
              <label v-if="draft.code === 103" class="var-cmd-field">
                <span class="text-cmd-label">{{ t('eventcmd.digits') }}</span>
                <input :value="numberParam(1,1)" type="number" min="1" max="8" @input="setParam(1, numberValue($event))" />
              </label>
              <label v-else class="var-cmd-field">
                <span class="text-cmd-label">{{ t('eventcmd.itemType') }}</span>
                <select :value="numberParam(1,2)" @change="setParam(1, numberValue($event))">
                  <option :value="1">{{ t('eventcmd.itemRegular') }}</option>
                  <option :value="2">{{ t('eventcmd.itemKey') }}</option>
                  <option :value="3">{{ t('eventcmd.itemHiddenA') }}</option>
                  <option :value="4">{{ t('eventcmd.itemHiddenB') }}</option>
                </select>
              </label>
            </template>
            <template v-else-if="draft.code === 105">
              <label class="full">{{ t('eventcmd.text') }}<span ref="textInputWrapRef" class="text-cmd-input-wrap"><textarea ref="textAreaRef" v-model="multiText" rows="10" @input="scheduleTextGuideMeasure" /><span class="text-guide-line" :style="{ left: `${scrollGuideLeft}px` }" aria-hidden="true" /></span></label>
              <div class="scroll-cmd-options">
                <label class="scroll-cmd-speed">{{ t('eventcmd.speed') }}<input :value="numberParam(0,2)" type="number" min="1" max="8" @input="setParam(0, numberValue($event))" /></label>
                <label class="check"><input :checked="boolParam(1)" type="checkbox" @change="setParam(1, checkedValue($event))" />{{ t('eventcmd.disableFastForward') }}</label>
                <button type="button" class="editor-btn scroll-cmd-preview" @click="openScrollPreview">{{ t('eventcmd.preview') }}</button>
              </div>
            </template>
            <label v-else-if="draft.code === 108" class="full">{{ t('eventcmd.comment') }}<textarea v-model="multiText" rows="7" /></label>
            <label v-else-if="draft.code === 355" class="full">{{ t('eventcmd.script') }}<textarea v-model="multiText" rows="11" spellcheck="false" /></label>
            <template v-else-if="draft.code === 356 || draft.code === 357">
              <div class="plugin-command-editor">
                <label>
                  {{ t('eventcmd.pluginName') }}
                  <el-select :model-value="pluginCommandPlugin" filterable popper-class="plugin-command-popper" :popper-style="{ zIndex: LAYER_Z.pluginParameterPopover }" @update:model-value="selectPluginForCommand">
                    <el-option value="" :label="t('eventcmd.allPlugins')" />
                    <el-option v-for="plugin in commandCapablePluginEntries" :key="plugin.name" :value="plugin.name" :label="plugin.name">
                      <span class="plugin-option-name">{{ plugin.name }}</span>
                      <span class="plugin-option-desc">{{ plugin.description }}</span>
                    </el-option>
                  </el-select>
                </label>
                <label>
                  {{ t('eventcmd.sourceHints') }}
                  <select :value="matchedPluginCommandHintKey" @change="applyPluginCommandHint">
                    <option value="">{{ t('eventcmd.selectHint') }}</option>
                    <option v-for="hint in visiblePluginCommandHints" :key="pluginCommandHintKey(hint)" :value="pluginCommandHintKey(hint)">
                      {{ pluginCommandHintLabel(hint) }}
                    </option>
                  </select>
                </label>
                <label v-if="draft.code === 356" class="full">
                  {{ t('eventcmd.pluginCommand') }}
                  <textarea :value="stringParam(0)" rows="5" spellcheck="false" @input="setParam(0,inputValue($event))" />
                </label>
                <template v-else>
                  <div class="full plugin-command-name-row">
                    <span>{{ t('eventcmd.commandName') }}</span>
                    <el-tag effect="plain" class="plugin-command-name">{{ stringParam(2) || stringParam(1) || t('eventcmd.selectHint') }}</el-tag>
                  </div>
                  <div v-if="selectedMZPluginHint?.arguments?.length" class="full plugin-args-wrap">
                    <table class="plugin-args-table">
                      <thead><tr><th>{{ t('eventcmd.argLabel') }}</th><th>{{ t('eventcmd.argKey') }}</th><th>{{ t('eventcmd.argType') }}</th><th>{{ t('eventcmd.argValue') }}</th></tr></thead>
                      <tbody>
                        <tr v-for="argument in selectedMZPluginHint.arguments" :key="argument.name" @dblclick="openPluginArgumentEditor(argument)">
                          <td class="plugin-arg-name">
                            <span>{{ argument.label || argument.name }}</span>
                            <small v-if="argument.description">{{ argument.description }}</small>
                          </td>
                          <td class="plugin-arg-key"><code>{{ argument.name }}</code></td>
                          <td class="plugin-arg-type">{{ pluginArgumentTypeLabel(argument) }}</td>
                          <td class="plugin-arg-value">
                            <el-switch v-if="argument.kind === 'boolean'" size="small" :model-value="['true','on','1'].includes(mzPluginArgument(argument.name).toLowerCase())" @update:model-value="setMZPluginArgument(argument, $event)" @dblclick.stop />
                            <template v-else>
                              <span class="plugin-arg-preview">{{ mzPluginArgument(argument.name) }}</span>
                              <button type="button" class="editor-btn plugin-arg-edit" :aria-label="t('eventEditorDialog.editCmd')" @click.stop="openPluginArgumentEditor(argument)">…</button>
                            </template>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </template>
                <div v-if="pluginCommandError" class="plugin-command-warning">{{ pluginCommandError }}</div>
                <div v-else-if="!visiblePluginCommandHints.length" class="plugin-command-warning">
                  {{ t('eventcmd.unsupported') }}
                </div>
              </div>
            </template>
            <template v-else-if="draft.code === 302">
              <div class="shop-cmd-layout">
                <table class="shop-goods-table" tabindex="0" @keydown.delete.prevent="removeShopGoods">
                  <thead>
                    <tr><th>{{ t('eventcmd.shopMerchandise') }}</th><th class="shop-price-col">{{ t('eventcmd.shopPrice') }}</th></tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(entry, index) in shopGoods"
                      :key="index"
                      :class="{ active: shopGoodsIndex === index }"
                      @click="shopGoodsIndex = index"
                      @dblclick="editShopGoods(index)"
                    >
                      <td>{{ shopGoodsName(entry) }}</td>
                      <td class="shop-price-col">{{ entry.priceType === 1 ? entry.price : t('eventcmd.shopPriceStandard') }}</td>
                    </tr>
                    <tr class="shop-goods-empty" @dblclick="addShopGoods">
                      <td colspan="2"></td>
                    </tr>
                  </tbody>
                </table>
                <p class="form-note">{{ t('eventcmd.shopHint') }}</p>
                <label class="check"><input :checked="boolParam(4)" type="checkbox" @change="setParam(4, checkedValue($event))" />{{ t('eventcmd.shopPurchaseOnly') }}</label>
              </div>
            </template>
            <template v-else-if="draft.code === 124">
              <fieldset class="cond-group">
                <legend>{{ t('eventcmd.operationTitle') }}</legend>
                <div class="cond-row cond-radios">
                  <label><input type="radio" name="timer-op" :checked="numberParam(0)===0" @change="setParam(0,0)" />{{ t('eventcmd.timerStart') }}</label>
                  <label><input type="radio" name="timer-op" :checked="numberParam(0)===1" @change="setParam(0,1)" />{{ t('eventcmd.timerStop') }}</label>
                </div>
              </fieldset>
              <fieldset class="cond-group">
                <legend>{{ t('eventcmd.timeTitle') }}</legend>
                <div class="cond-row cond-inline">
                  <input :value="Math.floor(numberParam(1,60)/60)" type="number" min="0" :disabled="numberParam(0)!==0" @input="setCondTimer(numberValue($event),numberParam(1,60)%60)" /><span class="cond-unit">{{ t('eventcmd.timerMin') }}</span>
                  <input :value="numberParam(1,60)%60" type="number" min="0" max="59" :disabled="numberParam(0)!==0" @input="setCondTimer(Math.floor(numberParam(1,60)/60),numberValue($event))" /><span class="cond-unit">{{ t('eventcmd.timerSec') }}</span>
                </div>
              </fieldset>
            </template>
            <template v-else-if="draft.code === 223">
              <fieldset class="cond-group tone-group">
                <legend>{{ t('eventcmd.toneTitle') }}</legend>
                <ToneColorSliders :channels="toneChannels" :values="arrayParam(0)" :presets="tonePresets" preview="tone" @change="(i, v) => setArrayItem(0, i, v)" @apply="(vals) => setArrayParam(0, vals)" />
              </fieldset>
              <div class="dur-row">
                <span class="text-cmd-label">{{ t('eventcmd.durationLabel') }}</span>
                <input :value="numberParam(1,60)" type="number" min="1" @input="setParam(1,numberValue($event))" />
                <span class="cond-unit">{{ t('eventcmd.framesUnit') }}</span>
                <label class="check"><input :checked="boolParam(2,true)" type="checkbox" @change="setParam(2,checkedValue($event))" />{{ t('eventcmd.waitForCompletion') }}</label>
              </div>
            </template>
            <template v-else-if="draft.code === 234">
              <label class="var-cmd-field">
                <span class="text-cmd-label">{{ t('eventcmd.pictureNumber') }}</span>
                <input :value="numberParam(0,1)" type="number" min="1" max="100" @input="setParam(0,numberValue($event))" />
              </label>
              <fieldset class="cond-group tone-group">
                <legend>{{ t('eventcmd.toneTitle') }}</legend>
                <ToneColorSliders :channels="toneChannels" :values="arrayParam(1)" :presets="tonePresets" preview="tone" @change="(i, v) => setArrayItem(1, i, v)" @apply="(vals) => setArrayParam(1, vals)" />
              </fieldset>
              <div class="dur-row">
                <span class="text-cmd-label">{{ t('eventcmd.durationLabel') }}</span>
                <input :value="numberParam(2,60)" type="number" min="1" @input="setParam(2,numberValue($event))" />
                <span class="cond-unit">{{ t('eventcmd.framesUnit') }}</span>
                <label class="check"><input :checked="boolParam(3,true)" type="checkbox" @change="setParam(3,checkedValue($event))" />{{ t('eventcmd.waitForCompletion') }}</label>
              </div>
            </template>
            <template v-else-if="draft.code === 224">
              <fieldset class="cond-group tone-group">
                <legend>{{ t('eventcmd.flashColorTitle') }}</legend>
                <ToneColorSliders :channels="flashChannels" :values="arrayParam(0)" preview="flash" @change="(i, v) => setArrayItem(0, i, v)" />
              </fieldset>
              <div class="dur-row">
                <span class="text-cmd-label">{{ t('eventcmd.durationLabel') }}</span>
                <input :value="numberParam(1,60)" type="number" min="1" @input="setParam(1,numberValue($event))" />
                <span class="cond-unit">{{ t('eventcmd.framesUnit') }}</span>
                <label class="check"><input :checked="boolParam(2,true)" type="checkbox" @change="setParam(2,checkedValue($event))" />{{ t('eventcmd.waitForCompletion') }}</label>
              </div>
            </template>
            <template v-else-if="draft.code === 138">
              <fieldset class="cond-group tone-group">
                <legend>{{ t('eventcmd.windowColorTitle') }}</legend>
                <ToneColorSliders :channels="rgbChannels" :values="arrayParam(0).slice(0, 3)" preview="rgb" @change="(i, v) => setArrayItem(0, i, v)" />
              </fieldset>
            </template>
            <template v-else-if="draft.code === 225">
              <fieldset class="cond-group tone-group">
                <legend>{{ t('eventcmd.shakeTitle') }}</legend>
                <ToneColorSliders :channels="shakeChannels" :values="[numberParam(0,5), numberParam(1,5)]" @change="(i, v) => setParam(i, v)" />
              </fieldset>
              <div class="dur-row">
                <span class="text-cmd-label">{{ t('eventcmd.durationLabel') }}</span>
                <input :value="numberParam(2,60)" type="number" min="1" @input="setParam(2,numberValue($event))" />
                <span class="cond-unit">{{ t('eventcmd.framesUnit') }}</span>
                <label class="check"><input :checked="boolParam(3,true)" type="checkbox" @change="setParam(3,checkedValue($event))" />{{ t('eventcmd.waitForCompletion') }}</label>
              </div>
            </template>
            <template v-else-if="draft.code === 236">
              <fieldset class="cond-group tone-group">
                <legend>{{ t('eventcmd.weatherTitle') }}</legend>
                <label class="var-cmd-field">
                  <span class="text-cmd-label">{{ t('eventcmd.weatherType') }}</span>
                  <select :value="stringParam(0,'none')" @change="setParam(0,inputValue($event))">
                    <option value="none">{{ t('eventcmd.weatherNone') }}</option><option value="rain">{{ t('eventcmd.weatherRain') }}</option><option value="storm">{{ t('eventcmd.weatherStorm') }}</option><option value="snow">{{ t('eventcmd.weatherSnow') }}</option>
                  </select>
                </label>
                <ToneColorSliders :channels="weatherChannels" :values="[numberParam(1,5)]" @change="(_, v) => setParam(1, v)" />
              </fieldset>
              <div class="dur-row">
                <span class="text-cmd-label">{{ t('eventcmd.durationLabel') }}</span>
                <input :value="numberParam(2,60)" type="number" min="1" @input="setParam(2,numberValue($event))" />
                <span class="cond-unit">{{ t('eventcmd.framesUnit') }}</span>
                <label class="check"><input :checked="boolParam(3,true)" type="checkbox" @change="setParam(3,checkedValue($event))" />{{ t('eventcmd.waitForCompletion') }}</label>
              </div>
            </template>
            <template v-else-if="draft.code === 322">
              <label class="var-cmd-field">
                <span class="text-cmd-label">{{ t('eventcmd.actor') }}</span>
                <select :value="numberParam(0,1)" @change="setParam(0,numberValue($event))"><option v-for="entry in catalog?.actors||[]" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4,'0') }} {{ entry.name }}</option></select>
              </label>
              <div class="img-cell-row">
                <div class="img-cell"><span>{{ t('eventcmd.face') }}</span><canvas ref="faceCellRef" class="face-preview img-cell-canvas" width="96" height="96" @click="openActorImagePicker('face')" /></div>
                <div class="img-cell"><span>{{ t('eventcmd.charImage') }}</span><canvas ref="charCellRef" class="face-preview img-cell-canvas" width="96" height="96" @click="openActorImagePicker('character')" /></div>
                <div class="img-cell"><span>{{ t('eventcmd.battlerImage') }}</span><canvas ref="battlerCellRef" class="face-preview img-cell-canvas" width="96" height="96" @click="openActorImagePicker('battler')" /></div>
              </div>
            </template>
            <template v-else-if="draft.code === 323">
              <label class="var-cmd-field">
                <span class="text-cmd-label">{{ t('eventcmd.vehicle') }}</span>
                <select :value="numberParam(0)" @change="setParam(0,numberValue($event))"><option :value="0">{{ t('eventcmd.vehicleBoat') }}</option><option :value="1">{{ t('eventcmd.vehicleShip') }}</option><option :value="2">{{ t('eventcmd.vehicleAirship') }}</option></select>
              </label>
              <div class="img-cell-row">
                <div class="img-cell"><span>{{ t('eventcmd.charImage') }}</span><canvas ref="charCellRef" class="face-preview img-cell-canvas" width="96" height="96" @click="openVehicleImagePicker" /></div>
              </div>
            </template>
            <template v-else-if="draft.code === 121 || draft.code === 122">
              <div class="cond-cmd-layout">
                <fieldset class="cond-group">
                  <legend>{{ draft.code === 121 ? t('eventcmd.condSwitch') : t('eventcmd.variable') }}</legend>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="gp-range" :checked="!gpRangeMode" @change="setGpRangeMode(false)" />{{ t('eventcmd.entrySingle') }}</label>
                    <span class="var-cmd-row cond-main"><input :value="namedEntryDisplay(draft.code===121?'switch':'variable', numberParam(0,1))" readonly :disabled="gpRangeMode" @click="!gpRangeMode&&openNamedEntry(draft.code===121?'switch':'variable',0,1)" /><button type="button" class="editor-btn" :disabled="gpRangeMode" @click="openNamedEntry(draft.code===121?'switch':'variable',0,1)">…</button></span>
                  </div>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="gp-range" :checked="gpRangeMode" @change="setGpRangeMode(true)" />{{ t('eventcmd.entryRange') }}</label>
                    <span class="cond-main cond-inline"><input :value="numberParam(0,1)" type="number" min="1" :disabled="!gpRangeMode" @input="setParam(0,numberValue($event))" /><span class="cond-unit">~</span><input :value="numberParam(1,1)" type="number" min="1" :disabled="!gpRangeMode" @input="setParam(1,numberValue($event))" /></span>
                  </div>
                </fieldset>
                <fieldset class="cond-group">
                  <legend>{{ t('eventcmd.operationTitle') }}</legend>
                  <div v-if="draft.code === 121" class="cond-row cond-radios">
                    <label><input type="radio" name="gp-op" :checked="numberParam(2)===0" @change="setParam(2,0)" />ON</label>
                    <label><input type="radio" name="gp-op" :checked="numberParam(2)===1" @change="setParam(2,1)" />OFF</label>
                  </div>
                  <div v-else class="cond-row cond-radios">
                    <label v-for="(key, index) in gpOpKeys" :key="key"><input type="radio" name="gp-op" :checked="numberParam(2)===index" @change="setParam(2,index)" />{{ t(key) }}</label>
                  </div>
                </fieldset>
                <fieldset v-if="draft.code === 122" class="cond-group">
                  <legend>{{ t('eventcmd.operandTitle') }}</legend>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="gp-operand" :checked="numberParam(3)===0" @change="setVariableOperand(0)" />{{ t('eventcmd.condConstant') }}</label>
                    <input class="cond-main" :value="numberParam(4)" type="number" :disabled="numberParam(3)!==0" @input="setParam(4,numberValue($event))" />
                  </div>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="gp-operand" :checked="numberParam(3)===1" @change="setVariableOperand(1)" />{{ t('eventcmd.variable') }}</label>
                    <span class="var-cmd-row cond-main"><input :value="namedEntryDisplay('variable', numberParam(4,1))" readonly :disabled="numberParam(3)!==1" @click="numberParam(3)===1&&openNamedEntry('variable',4)" /><button type="button" class="editor-btn" :disabled="numberParam(3)!==1" @click="openNamedEntry('variable',4)">…</button></span>
                  </div>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="gp-operand" :checked="numberParam(3)===2" @change="setVariableOperand(2)" />{{ t('eventcmd.operandRandom') }}</label>
                    <span class="cond-main cond-inline"><input :value="numberParam(4)" type="number" :disabled="numberParam(3)!==2" @input="setParam(4,numberValue($event))" /><span class="cond-unit">~</span><input :value="numberParam(5)" type="number" :disabled="numberParam(3)!==2" @input="setParam(5,numberValue($event))" /></span>
                  </div>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="gp-operand" :checked="numberParam(3)===3" @change="setVariableOperand(3)" />{{ t('eventcmd.operandGameData') }}</label>
                    <span class="cond-main cond-inline gp-gamedata">
                      <select :value="numberParam(4)" :disabled="numberParam(3)!==3" @change="setParam(4,numberValue($event))"><option v-for="(key, index) in gpGameDataKeys" :key="key" :value="index">{{ t(key) }}</option></select>
                      <input :value="numberParam(5)" type="number" :disabled="numberParam(3)!==3" @input="setParam(5,numberValue($event))" :title="t('eventcmd.dataParam1')" />
                      <input :value="numberParam(6)" type="number" :disabled="numberParam(3)!==3" @input="setParam(6,numberValue($event))" :title="t('eventcmd.dataParam2')" />
                    </span>
                  </div>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="gp-operand" :checked="numberParam(3)===4" @change="setVariableOperand(4)" />{{ t('eventcmd.script') }}</label>
                    <input class="cond-main" :value="stringParam(4)" spellcheck="false" :disabled="numberParam(3)!==4" @input="setParam(4,inputValue($event))" />
                  </div>
                </fieldset>
              </div>
            </template>
            <template v-else-if="draft.code === 111">
              <div class="cond-cmd-layout">
                <nav class="editor-tab-strip cond-tabs" :aria-label="t('eventcmd.pages')">
                  <button v-for="n in 4" :key="n" type="button" :class="{ active: condTab === n }" @click="condTab = n">{{ n }}</button>
                </nav>
                <div v-show="condTab === 1" class="cond-tab">
                  <div v-show="numberParam(0)===0" class="cond-row">
                    <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===0" @change="setConditionType(0)" />{{ t('eventcmd.condSwitch') }}</label>
                    <span class="var-cmd-row cond-main"><input :value="conditionalNamedEntryDisplay('switch',1,0)" readonly :disabled="numberParam(0)!==0" @click="numberParam(0)===0&&openNamedEntry('switch',1)" /><button type="button" class="editor-btn" :disabled="numberParam(0)!==0" @click="openNamedEntry('switch',1)">…</button></span>
                    <select :value="conditionalNumberParam(0,2)" :disabled="numberParam(0)!==0" @change="setParam(2,numberValue($event))"><option :value="0">ON</option><option :value="1">OFF</option></select>
                  </div>
                  <template v-if="numberParam(0)===1">
                    <div class="cond-row">
                      <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===1" @change="setConditionType(1)" />{{ t('eventcmd.variable') }}</label>
                      <span class="var-cmd-row cond-main"><input :value="conditionalNamedEntryDisplay('variable',1,1)" readonly :disabled="numberParam(0)!==1" @click="numberParam(0)===1&&openNamedEntry('variable',1)" /><button type="button" class="editor-btn" :disabled="numberParam(0)!==1" @click="openNamedEntry('variable',1)">…</button></span>
                      <select :value="conditionalNumberParam(1,4)" :disabled="numberParam(0)!==1" @change="setParam(4,numberValue($event))">
                        <option :value="0">=</option><option :value="1">≥</option><option :value="2">≤</option><option :value="3">&gt;</option><option :value="4">&lt;</option><option :value="5">≠</option>
                      </select>
                    </div>
                    <div class="cond-row cond-sub" :class="{ inactive: conditionalNumberParam(1,2)!==0 }">
                      <label class="cond-pick"><input type="radio" name="cond-var-operand" :checked="conditionalNumberParam(1,2)===0" :disabled="numberParam(0)!==1" @change="setVarOperand(0)" />{{ t('eventcmd.condConstant') }}</label>
                      <input class="cond-main" :value="conditionalNumberParam(1,3)" type="number" :disabled="numberParam(0)!==1||conditionalNumberParam(1,2)!==0" @input="setParam(3,numberValue($event))" />
                    </div>
                    <div class="cond-row cond-sub" :class="{ inactive: conditionalNumberParam(1,2)!==1 }">
                      <label class="cond-pick"><input type="radio" name="cond-var-operand" :checked="conditionalNumberParam(1,2)===1" :disabled="numberParam(0)!==1" @change="setVarOperand(1)" />{{ t('eventcmd.variable') }}</label>
                      <span class="var-cmd-row cond-main"><input :value="conditionalNamedEntryDisplay('variable',3,1)" readonly :disabled="numberParam(0)!==1||conditionalNumberParam(1,2)!==1" @click="numberParam(0)===1&&conditionalNumberParam(1,2)===1&&openNamedEntry('variable',3)" /><button type="button" class="editor-btn" :disabled="numberParam(0)!==1||conditionalNumberParam(1,2)!==1" @click="openNamedEntry('variable',3)">…</button></span>
                    </div>
                  </template>
                  <div v-show="numberParam(0)===2" class="cond-row">
                    <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===2" @change="setConditionType(2)" />{{ t('eventcmd.condSelfSwitch') }}</label>
                    <select class="cond-main" :value="conditionalStringParam(2,1,'A')" :disabled="numberParam(0)!==2" @change="setParam(1,inputValue($event))"><option v-for="s in ['A','B','C','D']" :key="s" :value="s">{{ s }}</option></select>
                    <select :value="conditionalNumberParam(2,2)" :disabled="numberParam(0)!==2" @change="setParam(2,numberValue($event))"><option :value="0">ON</option><option :value="1">OFF</option></select>
                  </div>
                  <div v-show="numberParam(0)===3" class="cond-row">
                    <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===3" @change="setConditionType(3)" />{{ t('eventcmd.condTimer') }}</label>
                    <span class="cond-main cond-inline">
                      <select :value="conditionalNumberParam(3,2)" :disabled="numberParam(0)!==3" @change="setParam(2,numberValue($event))"><option :value="0">{{ t('eventcmd.condAtLeast') }}</option><option :value="1">{{ t('eventcmd.condAtMost') }}</option></select>
                      <input :value="activeConditionalType()===3?Math.floor(Number(conditionalNumberParam(3,1,0))/60):''" type="number" min="0" :disabled="numberParam(0)!==3" @input="setCondTimer(numberValue($event),Number(conditionalNumberParam(3,1,0))%60)" /><span class="cond-unit">{{ t('eventcmd.timerMin') }}</span>
                      <input :value="activeConditionalType()===3?Number(conditionalNumberParam(3,1,0))%60:''" type="number" min="0" max="59" :disabled="numberParam(0)!==3" @input="setCondTimer(Math.floor(Number(conditionalNumberParam(3,1,0))/60),numberValue($event))" /><span class="cond-unit">{{ t('eventcmd.timerSec') }}</span>
                    </span>
                  </div>
                </div>
                <div v-show="condTab === 2" class="cond-tab">
                  <template v-if="numberParam(0)===4">
                    <div class="cond-row">
                      <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===4" @change="setConditionType(4)" />{{ t('eventcmd.condActor') }}</label>
                      <select class="cond-main" :value="conditionalNumberParam(4,1,1)" :disabled="numberParam(0)!==4" @change="setParam(1,numberValue($event))"><option v-for="entry in catalog?.actors||[]" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4,'0') }} {{ entry.name }}</option></select>
                    </div>
                    <div class="cond-row cond-sub" :class="{ inactive: conditionalNumberParam(4,2)!==0 }">
                      <label class="cond-pick"><input type="radio" name="cond-actor" :checked="conditionalNumberParam(4,2)===0" :disabled="numberParam(0)!==4" @change="setActorCondition(0)" />{{ t('eventcmd.condInParty') }}</label>
                    </div>
                    <div class="cond-row cond-sub" :class="{ inactive: conditionalNumberParam(4,2)!==1 }">
                      <label class="cond-pick"><input type="radio" name="cond-actor" :checked="conditionalNumberParam(4,2)===1" :disabled="numberParam(0)!==4" @change="setActorCondition(1)" />{{ t('eventcmd.condName') }}</label>
                      <input class="cond-main" :value="conditionalStringParam(4,3)" :disabled="numberParam(0)!==4||conditionalNumberParam(4,2)!==1" @input="setParam(3,inputValue($event))" />
                    </div>
                    <div class="cond-row cond-sub" :class="{ inactive: conditionalNumberParam(4,2)!==2 }">
                      <label class="cond-pick"><input type="radio" name="cond-actor" :checked="conditionalNumberParam(4,2)===2" :disabled="numberParam(0)!==4" @change="setActorCondition(2)" />{{ t('eventcmd.condClass') }}</label>
                      <select class="cond-main" :value="conditionalNumberParam(4,3,1)" :disabled="numberParam(0)!==4||conditionalNumberParam(4,2)!==2" @change="setParam(3,numberValue($event))"><option v-for="entry in catalog?.classes||[]" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4,'0') }} {{ entry.name }}</option></select>
                    </div>
                    <div class="cond-row cond-sub" :class="{ inactive: conditionalNumberParam(4,2)!==3 }">
                      <label class="cond-pick"><input type="radio" name="cond-actor" :checked="conditionalNumberParam(4,2)===3" :disabled="numberParam(0)!==4" @change="setActorCondition(3)" />{{ t('eventcmd.condSkill') }}</label>
                      <select class="cond-main" :value="conditionalNumberParam(4,3,1)" :disabled="numberParam(0)!==4||conditionalNumberParam(4,2)!==3" @change="setParam(3,numberValue($event))"><option v-for="entry in catalog?.skills||[]" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4,'0') }} {{ entry.name }}</option></select>
                    </div>
                    <div class="cond-row cond-sub" :class="{ inactive: conditionalNumberParam(4,2)!==4 }">
                      <label class="cond-pick"><input type="radio" name="cond-actor" :checked="conditionalNumberParam(4,2)===4" :disabled="numberParam(0)!==4" @change="setActorCondition(4)" />{{ t('eventcmd.goodsWeapon') }}</label>
                      <select class="cond-main" :value="conditionalNumberParam(4,3,1)" :disabled="numberParam(0)!==4||conditionalNumberParam(4,2)!==4" @change="setParam(3,numberValue($event))"><option v-for="entry in catalog?.weapons||[]" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4,'0') }} {{ entry.name }}</option></select>
                    </div>
                    <div class="cond-row cond-sub" :class="{ inactive: conditionalNumberParam(4,2)!==5 }">
                      <label class="cond-pick"><input type="radio" name="cond-actor" :checked="conditionalNumberParam(4,2)===5" :disabled="numberParam(0)!==4" @change="setActorCondition(5)" />{{ t('eventcmd.goodsArmor') }}</label>
                      <select class="cond-main" :value="conditionalNumberParam(4,3,1)" :disabled="numberParam(0)!==4||conditionalNumberParam(4,2)!==5" @change="setParam(3,numberValue($event))"><option v-for="entry in catalog?.armors||[]" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4,'0') }} {{ entry.name }}</option></select>
                    </div>
                    <div class="cond-row cond-sub" :class="{ inactive: conditionalNumberParam(4,2)!==6 }">
                      <label class="cond-pick"><input type="radio" name="cond-actor" :checked="conditionalNumberParam(4,2)===6" :disabled="numberParam(0)!==4" @change="setActorCondition(6)" />{{ t('eventcmd.condState') }}</label>
                      <select class="cond-main" :value="conditionalNumberParam(4,3,1)" :disabled="numberParam(0)!==4||conditionalNumberParam(4,2)!==6" @change="setParam(3,numberValue($event))"><option v-for="entry in catalog?.states||[]" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4,'0') }} {{ entry.name }}</option></select>
                    </div>
                  </template>
                </div>
                <div v-show="condTab === 3" class="cond-tab">
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===5" @change="setConditionType(5)" />{{ t('eventcmd.condEnemy') }}</label>
                    <select class="cond-main" :value="conditionalNumberParam(5,1)" :disabled="numberParam(0)!==5" @change="setParam(1,numberValue($event))"><option v-for="n in 8" :key="n" :value="n-1">#{{ n }}</option></select>
                  </div>
                  <div class="cond-row cond-sub">
                    <label class="cond-pick"><input type="radio" name="cond-enemy" :checked="conditionalNumberParam(5,2)===0" :disabled="numberParam(0)!==5" @change="setEnemyCondition(0)" />{{ t('eventcmd.condAppeared') }}</label>
                  </div>
                  <div class="cond-row cond-sub">
                    <label class="cond-pick"><input type="radio" name="cond-enemy" :checked="conditionalNumberParam(5,2)===1" :disabled="numberParam(0)!==5" @change="setEnemyCondition(1)" />{{ t('eventcmd.condState') }}</label>
                    <select class="cond-main" :value="conditionalNumberParam(5,3,1)" :disabled="numberParam(0)!==5||conditionalNumberParam(5,2)!==1" @change="setParam(3,numberValue($event))"><option v-for="entry in catalog?.states||[]" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4,'0') }} {{ entry.name }}</option></select>
                  </div>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===6" @change="setConditionType(6)" />{{ t('eventcmd.condCharacter') }}</label>
                    <select class="cond-main" :value="conditionalNumberParam(6,1)" :disabled="numberParam(0)!==6" @change="setParam(1,numberValue($event))">
                      <option :value="-1">{{ t('cmdFields.player') }}</option><option :value="0">{{ t('cmdFields.thisEvent') }}</option>
                      <option v-for="event in sortedCurrentEvents" :key="event.id" :value="event.id">{{ t('cmdFields.mapEvent',{id:String(event.id).padStart(3,'0'),name:event.name}) }}</option>
                    </select>
                    <select :value="conditionalNumberParam(6,2,2)" :disabled="numberParam(0)!==6" @change="setParam(2,numberValue($event))">
                      <option :value="2">{{ t('eventcmd.dirDown') }}</option><option :value="4">{{ t('eventcmd.dirLeft') }}</option><option :value="6">{{ t('eventcmd.dirRight') }}</option><option :value="8">{{ t('eventcmd.dirUp') }}</option>
                    </select>
                  </div>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===13" @change="setConditionType(13)" />{{ t('eventcmd.condVehicle') }}</label>
                    <select class="cond-main" :value="conditionalNumberParam(13,1)" :disabled="numberParam(0)!==13" @change="setParam(1,numberValue($event))"><option :value="0">{{ t('eventcmd.vehicleBoat') }}</option><option :value="1">{{ t('eventcmd.vehicleShip') }}</option><option :value="2">{{ t('eventcmd.vehicleAirship') }}</option></select>
                  </div>
                </div>
                <div v-show="condTab === 4" class="cond-tab">
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===7" @change="setConditionType(7)" />{{ t('eventcmd.condGold') }}</label>
                    <input class="cond-main" :value="conditionalNumberParam(7,1)" type="number" min="0" :disabled="numberParam(0)!==7" @input="setParam(1,numberValue($event))" />
                    <select :value="conditionalNumberParam(7,2)" :disabled="numberParam(0)!==7" @change="setParam(2,numberValue($event))"><option :value="0">{{ t('eventcmd.condAtLeast') }}</option><option :value="1">{{ t('eventcmd.condAtMost') }}</option><option :value="2">{{ t('eventcmd.condBelow') }}</option></select>
                  </div>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===8" @change="setConditionType(8)" />{{ t('eventcmd.goodsItem') }}</label>
                    <select class="cond-main" :value="conditionalNumberParam(8,1,1)" :disabled="numberParam(0)!==8" @change="setParam(1,numberValue($event))"><option v-for="entry in catalog?.items||[]" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4,'0') }} {{ entry.name }}</option></select>
                  </div>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===9" @change="setConditionType(9)" />{{ t('eventcmd.goodsWeapon') }}</label>
                    <select class="cond-main" :value="conditionalNumberParam(9,1,1)" :disabled="numberParam(0)!==9" @change="setParam(1,numberValue($event))"><option v-for="entry in catalog?.weapons||[]" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4,'0') }} {{ entry.name }}</option></select>
                    <label class="check cond-check"><input :checked="conditionalBooleanParam(9,2)" type="checkbox" :disabled="numberParam(0)!==9" @change="setParam(2,checkedValue($event))" />{{ t('eventcmd.includeEquip') }}</label>
                  </div>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===10" @change="setConditionType(10)" />{{ t('eventcmd.goodsArmor') }}</label>
                    <select class="cond-main" :value="conditionalNumberParam(10,1,1)" :disabled="numberParam(0)!==10" @change="setParam(1,numberValue($event))"><option v-for="entry in catalog?.armors||[]" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4,'0') }} {{ entry.name }}</option></select>
                    <label class="check cond-check"><input :checked="conditionalBooleanParam(10,2)" type="checkbox" :disabled="numberParam(0)!==10" @change="setParam(2,checkedValue($event))" />{{ t('eventcmd.includeEquip') }}</label>
                  </div>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===11" @change="setConditionType(11)" />{{ t('eventcmd.condButton') }}</label>
                    <select class="cond-main" :value="conditionalStringParam(11,1,'down')" :disabled="numberParam(0)!==11" @change="setParam(1,inputValue($event))">
                      <option v-for="entry in conditionalButtonKeys" :key="entry.value" :value="entry.value">{{ t(entry.label) }}</option>
                    </select>
                    <select v-if="currentEngine==='rpg-maker-mz'" :value="conditionalNumberParam(11,2,0)" :disabled="numberParam(0)!==11" @change="setParam(2,numberValue($event))">
                      <option v-for="entry in conditionalButtonModes" :key="entry.value" :value="entry.value">{{ t(entry.label) }}</option>
                    </select>
                  </div>
                  <div class="cond-row">
                    <label class="cond-pick"><input type="radio" name="cond-type" :checked="numberParam(0)===12" @change="setConditionType(12)" />{{ t('eventcmd.script') }}</label>
                    <input class="cond-main" :value="conditionalStringParam(12,1)" spellcheck="false" :disabled="numberParam(0)!==12" @input="setParam(1,inputValue($event))" />
                  </div>
                </div>
              </div>
              <label class="check cond-else"><input :checked="elseBranchEnabled" type="checkbox" @change="toggleElseBranch" />{{ t('eventcmd.createElse') }}</label>
            </template>
            <EventCommandFields v-else-if="commandDefinition(draft.code,currentEngine)" :command="draft" :engine="currentEngine" :catalog="catalog" :load-image="loadImage" :map-id="mapId" :current-events="currentEvents" :troop-members="troopMembers" @change="touchCommand" />
            <p v-else class="form-note unsupported-command">
              {{ t('eventcmd.unsupportedEditor') }}
            </p>
          </div>
        </div>

        <footer v-if="!pickerOpen" class="editor-modal-footer">
          <button type="button" class="editor-btn" @click="close">{{ t('eventcmd.cancel') }}</button>
          <button type="button" class="editor-btn primary" :disabled="draft?.code === 102 && Boolean(choiceError)" @click="commit">{{ t('eventcmd.ok') }}</button>
        </footer>
        <span v-if="!pickerOpen && draft" class="dialog-resize-handle" role="separator" :aria-label="t('eventcmd.resizeHandle')" :title="t('eventcmd.resizeHandle')" @pointerdown.prevent="onDialogResizeStart" @pointermove="onDialogResizeMove" @pointerup="onDialogResizeEnd" @dblclick="resetDialogSize" />
      </section>
    </div>
  </teleport>
  <ImageAssetPickerDialog ref="imagePicker" :catalog="catalog" :load-image="loadImage" @commit="commitImageSelection" />
  <MoveRouteDialog ref="routeDialog" :preview-x="eventX" :preview-y="eventY" :catalog="catalog" @commit="setRoute" @cancel="cancelMergedRoute" />
  <PluginParameterValueDialog v-model="pluginArgumentEditorOpen" :field="pluginArgumentEditing" :value="pluginArgumentEditing ? mzPluginArgument(pluginArgumentEditing.name) : ''" :catalog="catalog" :dialog-z-index="LAYER_Z.pluginParameterDialog" allow-unchanged-commit @commit="commitPluginArgumentValue" @catalog-changed="emit('catalog-changed')" />
  <MessagePreviewDialog ref="messagePreview" :catalog="catalog" :load-image="loadImage" />
  <ScrollTextPreviewDialog ref="scrollPreview" :catalog="catalog" />
  <SystemNamedEntrySelectorDialog ref="namedEntrySelector" :catalog="catalog" @commit="commitNamedEntrySelection" @catalog-changed="emit('catalog-changed')" />
  <ShopGoodsDialog ref="shopGoodsDialog" :catalog="catalog" @commit="commitShopGoods" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { RpgMakerEngine } from '@contract/types';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import { confirmAboveModal } from '../../utils/confirmAboveModal';
import { plugins as pluginApi, type EditorProjectCatalog, type ManagedPluginEntry, type PluginCommandArgument, type PluginCommandHint, type PluginParameterSchemaField } from '../../api/client';
import { useProjectStore } from '../../stores/project';
import { commandPages, applyCommandIndent, commandDefinition, commandTemplate, normalizeEventCommandParameters } from '../../composables/eventCommandCatalog';
import { clone, defaultMoveRoute, type MvCommand, type MvMoveRoute } from '../../composables/useEventEditor';
import { localizeCommandGroups, localizeCommandLabel } from '../../utils/eventCommandLocalization';
import { mvFaceSourceRect } from '../../utils/rmmvFace';
import { isBigCharacterName } from '../../composables/useMapRenderer';
import { formatSystemNamedEntryId } from '../../utils/systemNamedEntryRanges';
import {
  applyConditionalBranchElse,
  conditionalElseBodyCommandCount,
  initializeConditionalBranchDraftMap,
  inspectConditionalBranchSpan,
  isConditionalNamedEntryTarget,
  isFinitePositiveInteger,
  switchConditionalBranchDraft,
  updateConditionalVariableOperand,
  validateConditionalBranchParameters,
  type ConditionalNamedEntryKind,
} from '../../utils/conditionalBranchEditor';
import { formatPluginParameterTypeLabel } from '../../utils/pluginParameterTypeLabel';
import EventCommandFields from './EventCommandFields.vue';
import ImageAssetPickerDialog from './ImageAssetPickerDialog.vue';
import MessagePreviewDialog from './MessagePreviewDialog.vue';
import MoveRouteDialog from './MoveRouteDialog.vue';
import PluginParameterValueDialog from '../console/PluginParameterValueDialog.vue';
import ScrollTextPreviewDialog from './ScrollTextPreviewDialog.vue';
import ShopGoodsDialog, { type ShopGoodsEntry } from './ShopGoodsDialog.vue';
import ToneColorSliders from './ToneColorSliders.vue';
import SystemNamedEntrySelectorDialog from './SystemNamedEntrySelectorDialog.vue';
import type { EditorEventListItem } from './editorTypes';
const props = withDefaults(defineProps<{ mapId:number|null; catalog:EditorProjectCatalog|null; loadImage:(url:string)=>Promise<HTMLImageElement|null>; eventX?:number; eventY?:number; currentEvents?:EditorEventListItem[]; troopMembers?:string[] }>(), { eventX: 0, eventY: 0 });
const emit = defineEmits<{ commit:[payload:{commands:MvCommand[];editSpan:number|null;insertSpan:number|null}]; 'catalog-changed':[] }>();
const projectStore = useProjectStore();
const { language, t } = useI18n();
const commandDialogZ = String(LAYER_Z.commandDialog);
const visible=ref(false),pickerOpen=ref(false),pickerPage=ref(1),draft=ref<MvCommand|null>(null),draftSpan=ref<MvCommand[]>([]),editSpan=ref<number|null>(null),insertSpan=ref<number|null>(null),insertIndent=ref(0),multiText=ref(''),batchInput=ref(false);
// RM-native Show Choices uses one line per option. Blank lines are ignored, but
// a seventh non-empty line is rejected rather than silently discarded.
const choiceText=ref('');
function parseChoiceLines(value:string):string[]{
  return value.split(/\r?\n/).map((line)=>line.trim()).filter(Boolean);
}
const choiceLines=computed(()=>parseChoiceLines(choiceText.value));
const choiceItemOptions=computed(()=>choiceLines.value.slice(0,6).map((label,value)=>({value,label:t('eventcmd.choiceItem',{n:value+1})})));
const invalidChoiceDefault=computed(()=>{
  if(draft.value?.code!==102)return false;
  const raw=draft.value.parameters[2];
  if(raw==null||raw==='')return false;
  const value=Number(raw);
  return !Number.isInteger(value)||value < -1 || value >= choiceLines.value.length;
});
const invalidChoiceCancel=computed(()=>{
  if(draft.value?.code!==102)return false;
  const raw=draft.value.parameters[1];
  if(raw==null||raw==='')return false;
  const value=Number(raw);
  return !Number.isInteger(value)||value < -2 || value >= choiceLines.value.length;
});
const choiceError=computed(()=>{
  if(draft.value?.code!==102)return '';
  if(!choiceLines.value.length)return t('eventcmd.choicesEmpty');
  if(choiceLines.value.length>6)return t('eventcmd.choiceTooMany');
  if(invalidChoiceDefault.value||invalidChoiceCancel.value)return t('eventcmd.choiceInvalidBlock');
  return '';
});
function scheduleChoiceValidation(){/* computed validation follows choiceText */}
const imagePicker=ref<InstanceType<typeof ImageAssetPickerDialog>>(),routeDialog=ref<InstanceType<typeof MoveRouteDialog>>(),facePreviewRef=ref<HTMLCanvasElement>(),messagePreview=ref<InstanceType<typeof MessagePreviewDialog>>();
type PendingNamedEntry = {kind:ConditionalNamedEntryKind;index:number;mirror?:number;conditionType:number|null};
const scrollPreview=ref<InstanceType<typeof ScrollTextPreviewDialog>>(),namedEntrySelector=ref<InstanceType<typeof SystemNamedEntrySelectorDialog>>(),pendingNamedEntry=ref<PendingNamedEntry>({kind:'variable',index:0,conditionType:null});
// RM-native Shop Processing: rows mirror head params + 605 continuations, rebuilt on commit.
const shopGoodsDialog=ref<InstanceType<typeof ShopGoodsDialog>>(),shopGoods=ref<ShopGoodsEntry[]>([]),shopGoodsIndex=ref<number|null>(null),shopGoodsEditIndex=ref<number|null>(null);
// RM-native Conditional Branch: four tabs of radio rows; each type keeps an isolated draft.
// Else is tracked separately from the raw span so canceling its removal leaves
// the original Then/Else commands untouched until the command is committed.
const condTab=ref(1),elseBranchEnabled=ref(false),conditionalTypeDrafts=ref<Record<number,unknown[]>>({});
const conditionalButtonKeys=[
  {value:'down',label:'eventcmd.dirDown'},
  {value:'left',label:'eventcmd.dirLeft'},
  {value:'right',label:'eventcmd.dirRight'},
  {value:'up',label:'eventcmd.dirUp'},
  {value:'ok',label:'eventcmd.buttonOk'},
  {value:'cancel',label:'eventcmd.buttonCancel'},
  {value:'shift',label:'eventcmd.buttonShift'},
  {value:'pageup',label:'eventcmd.buttonPageUp'},
  {value:'pagedown',label:'eventcmd.buttonPageDown'},
] as const;
const conditionalButtonModes=[
  {value:0,label:'eventcmd.buttonPressed'},
  {value:1,label:'eventcmd.buttonTriggered'},
  {value:2,label:'eventcmd.buttonRepeated'},
] as const;
// Change Actor/Vehicle Images (322/323): clickable preview cells; MZ stores the face slots first.
const faceCellRef=ref<HTMLCanvasElement>(),charCellRef=ref<HTMLCanvasElement>(),battlerCellRef=ref<HTMLCanvasElement>();
const pendingImageTarget=ref<{nameIndex:number;indexIndex?:number}|null>(null);
const actorImageSlots=computed(()=>currentEngine.value==='rpg-maker-mz'?{face:1,faceIndex:2,character:3,characterIndex:4,battler:5}:{character:1,characterIndex:2,face:3,faceIndex:4,battler:5});
// Control Switches/Variables: single mode mirrors start id into the end id.
// Tone/color commands keep an RGBA-like array inside a single parameter slot.
const toneChannels=computed(()=>[{label:t('eventcmd.colorRed'),min:-255,max:255},{label:t('eventcmd.colorGreen'),min:-255,max:255},{label:t('eventcmd.colorBlue'),min:-255,max:255},{label:t('eventcmd.colorGray'),min:0,max:255}]);
const flashChannels=computed(()=>[{label:t('eventcmd.colorRed'),min:0,max:255},{label:t('eventcmd.colorGreen'),min:0,max:255},{label:t('eventcmd.colorBlue'),min:0,max:255},{label:t('eventcmd.colorIntensity'),min:0,max:255}]);
const rgbChannels=computed(()=>[{label:t('eventcmd.colorRed'),min:-255,max:255},{label:t('eventcmd.colorGreen'),min:-255,max:255},{label:t('eventcmd.colorBlue'),min:-255,max:255}]);
const shakeChannels=computed(()=>[{label:t('eventcmd.shakePower'),min:1,max:9},{label:t('eventcmd.shakeSpeed'),min:1,max:9}]);
const weatherChannels=computed(()=>[{label:t('eventcmd.shakePower'),min:0,max:9}]);
// RM editor tone presets: Normal / Dark / Sepia / Sunset / Night.
const tonePresets=computed(()=>[{label:t('eventcmd.presetNormal'),values:[0,0,0,0]},{label:t('eventcmd.presetDark'),values:[-68,-68,-68,0]},{label:t('eventcmd.presetSepia'),values:[34,-34,-68,170]},{label:t('eventcmd.presetSunset'),values:[68,-34,-34,0]},{label:t('eventcmd.presetNight'),values:[-68,-68,0,68]}]);
function arrayParam(index:number):number[]{const value=draft.value?.parameters[index];return Array.isArray(value)?value.map((item)=>Number(item)||0):[];}
function setArrayItem(index:number,channel:number,value:number){if(!draft.value)return;const current=Array.isArray(draft.value.parameters[index])?[...(draft.value.parameters[index] as unknown[])]:[];current[channel]=value;draft.value.parameters[index]=current;touchCommand();}
function setArrayParam(index:number,values:number[]){if(!draft.value)return;const current=Array.isArray(draft.value.parameters[index])?[...(draft.value.parameters[index] as unknown[])]:[];values.forEach((item,channel)=>{current[channel]=item;});draft.value.parameters[index]=current;touchCommand();}
const gpRangeMode=ref(false);
const gpOpKeys=['eventcmd.opSet','eventcmd.opAdd','eventcmd.opSub','eventcmd.opMul','eventcmd.opDiv','eventcmd.opMod'] as const;
const gpGameDataKeys=['eventcmd.gameData0','eventcmd.gameData1','eventcmd.gameData2','eventcmd.gameData3','eventcmd.gameData4','eventcmd.gameData5','eventcmd.gameData6','eventcmd.gameData7'] as const;
function syncGpRangeMode(){gpRangeMode.value=(draft.value?.code===121||draft.value?.code===122)&&numberParam(0,1)!==numberParam(1,1);}
function setGpRangeMode(range:boolean){gpRangeMode.value=range;if(!range)setParam(1,numberParam(0,1));}
function setVariableOperand(type:number){if(!draft.value||draft.value.code!==122)return;draft.value.parameters=draft.value.parameters.slice(0,3).concat([type]);touchCommand();}
const sortedCurrentEvents=computed(()=>[...(props.currentEvents||[])].filter((event)=>Number.isInteger(event.id)&&event.id>0).sort((left,right)=>left.id-right.id));
function syncCondState(){const type=draft.value?.code===111?Number(draft.value.parameters[0])||0:0;condTab.value=type<=3?1:type===4?2:type===5||type===6||type===13?3:4;}
function activeConditionalType(){return draft.value?.code===111&&Number.isInteger(Number(draft.value.parameters[0]))?Number(draft.value.parameters[0]):-1;}
function initializeConditionalTypeDraft(){
  if(draft.value?.code!==111){conditionalTypeDrafts.value={};return;}
  conditionalTypeDrafts.value=initializeConditionalBranchDraftMap(draft.value.parameters);
}
function createConditionalTypeDraft(type:number){
  const next:MvCommand={code:111,indent:draft.value?.indent||0,parameters:[type]};
  normalizeEventCommandParameters(next,currentEngine.value);
  return next.parameters;
}
function setConditionType(type:number){
  if(!draft.value||draft.value.code!==111||activeConditionalType()===type)return;
  const switched=switchConditionalBranchDraft(
    conditionalTypeDrafts.value,
    draft.value.parameters,
    type,
    createConditionalTypeDraft,
  );
  conditionalTypeDrafts.value=switched.drafts;
  draft.value.parameters=switched.parameters;
  touchCommand();
}
function conditionalParam(type:number,index:number):unknown{return activeConditionalType()===type?draft.value?.parameters[index]:undefined;}
function conditionalNumberParam(type:number,index:number,fallback?:number):number|string{
  if(activeConditionalType()!==type)return '';
  const value=conditionalParam(type,index);
  if(value===undefined||value===null||value==='')return fallback??'';
  const number=Number(value);
  return Number.isFinite(number)?number:(fallback??'');
}
function conditionalStringParam(type:number,index:number,fallback=''){if(activeConditionalType()!==type)return '';const value=conditionalParam(type,index);return value===undefined||value===null?fallback:String(value);}
function conditionalBooleanParam(type:number,index:number,fallback=false){if(activeConditionalType()!==type)return false;const value=conditionalParam(type,index);return value===undefined||value===null?fallback:Boolean(value);}
function syncConditionalBranchState(){
  elseBranchEnabled.value=false;
  if(draft.value?.code!==111||draftSpan.value.length<2)return;
  elseBranchEnabled.value=inspectConditionalBranchSpan(draftSpan.value,currentEngine.value).elseIndex!==null;
}
function setVarOperand(operand:number){
  if(!draft.value||draft.value.code!==111||!Number.isInteger(operand)||operand<0||operand>1)return;
  try {
    draft.value.parameters=updateConditionalVariableOperand(draft.value.parameters,operand as 0|1);
    touchCommand();
  } catch (error) {
    ElMessage.error(`${t('eventcmd.invalidConditional')}: ${(error as Error).message}`);
  }
}
function setActorCondition(sub:number){setParam(2,sub);if(sub===1)setParam(3,'');else if(sub>=2)setParam(3,1);else setParam(3,0);}
function setEnemyCondition(sub:number){setParam(2,sub);setParam(3,sub===1?1:0);}
function setCondTimer(minutes:number,seconds:number){setParam(1,Math.max(0,minutes)*60+Math.max(0,Math.min(59,seconds)));}
function namedEntryDisplay(kind:'switch'|'variable',id:number){const list=kind==='switch'?props.catalog?.switches:props.catalog?.variables;const entry=(list||[]).find((item)=>item.id===id);const name=String(entry?.name||'').trim();return `${formatSystemNamedEntryId(id)}${name?` ${name}`:''}`;}
function conditionalNamedEntryDisplay(kind:'switch'|'variable',index:number,type:number){
  if(activeConditionalType()!==type)return '';
  const id=Number(conditionalParam(type,index));
  return isFinitePositiveInteger(id)?namedEntryDisplay(kind,id):t('eventcmd.invalidEntryId');
}
function openNamedEntry(kind:ConditionalNamedEntryKind,index:number,mirror?:number){
  const conditionType=draft.value?.code===111?activeConditionalType():null;
  pendingNamedEntry.value={kind,index,mirror,conditionType};
  namedEntrySelector.value?.open({kind,selectedId:numberParam(index,1),allowNone:false});
}
async function toggleElseBranch(event:Event){
  if(!draft.value||draft.value.code!==111)return;
  const checked=checkedValue(event);
  if(checked){elseBranchEnabled.value=true;return;}
  if(editSpan.value==null||!elseBranchEnabled.value){elseBranchEnabled.value=false;return;}
  let bodyCommandCount=0;
  try {
    bodyCommandCount=conditionalElseBodyCommandCount(draftSpan.value,currentEngine.value);
  } catch (error) {
    ElMessage.error(`${t('eventcmd.invalidConditional')}: ${(error as Error).message}`);
    const input=event.target as HTMLInputElement|null;
    if(input)input.checked=true;
    elseBranchEnabled.value=true;
    return;
  }
  if(bodyCommandCount===0){elseBranchEnabled.value=false;return;}
  try {
    await confirmAboveModal(t('eventcmd.removeElseConfirm',{count:bodyCommandCount}),t('eventcmd.removeElseTitle'));
    elseBranchEnabled.value=false;
  } catch {
    // Keep the original checked state and raw branch body when confirmation is canceled.
    const input=event.target as HTMLInputElement|null;
    if(input)input.checked=true;
    elseBranchEnabled.value=true;
  }
}
const pickerSearchRef=ref<HTMLInputElement>(),pickerListRef=ref<HTMLElement>(),pickerQuery=ref(''),activePickerIndex=ref(0);
const pickerListId='event-command-picker-list';
// Picker layout: 'paged' keeps the RM-native three-page grouping; 'table' consolidates
// every command group into one scrollable panel. The choice persists across sessions.
const PICKER_MODE_KEY='rpgmv.eventCommandPickerMode';
const pickerViewMode=ref<'paged'|'table'>(readPickerViewMode());
function readPickerViewMode():'paged'|'table'{try{return localStorage.getItem(PICKER_MODE_KEY)==='table'?'table':'paged';}catch{return 'paged';}}
function setPickerViewMode(mode:'paged'|'table'){pickerViewMode.value=mode;try{localStorage.setItem(PICKER_MODE_KEY,mode);}catch{/* persistence is best-effort */}}
// Per-command dialog size memory: the resize handle writes it, double-click clears it.
const SIZE_KEY='rpgmv.eventCommandDialogSize';
const dialogShellRef=ref<HTMLElement>();
const textInputWrapRef=ref<HTMLElement>();
const textAreaRef=ref<HTMLTextAreaElement>();
const measuredTextGuideLeft=ref(0);
const dialogSize=ref<{w:number;h:number}|null>(null);
let dialogResizeStart:{x:number;y:number;w:number;h:number;pointer:number}|null=null;
const clampDialogW=(w:number)=>Math.round(Math.max(480,Math.min(window.innerWidth-32,w)));
const clampDialogH=(h:number)=>Math.round(Math.max(320,Math.min(window.innerHeight-32,h)));
function readDialogSizes():Record<string,{w:number;h:number}>{try{const parsed=JSON.parse(localStorage.getItem(SIZE_KEY)||'{}');return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,{w:number;h:number}>:{};}catch{return{};}}
function loadDialogSize(code:number){const entry=readDialogSizes()[String(code)];dialogSize.value=entry&&Number.isFinite(entry?.w)&&Number.isFinite(entry?.h)?{w:clampDialogW(entry.w),h:clampDialogH(entry.h)}:null;}
function saveDialogSize(){if(!draft.value)return;const sizes=readDialogSizes();if(dialogSize.value)sizes[String(draft.value.code)]=dialogSize.value;else delete sizes[String(draft.value.code)];try{localStorage.setItem(SIZE_KEY,JSON.stringify(sizes));}catch{/* persistence is best-effort */}}
function resetDialogSize(){dialogSize.value=null;saveDialogSize();}
function onDialogResizeStart(event:PointerEvent){const rect=dialogShellRef.value?.getBoundingClientRect();if(!rect)return;dialogResizeStart={x:event.clientX,y:event.clientY,w:rect.width,h:rect.height,pointer:event.pointerId};dialogSize.value={w:Math.round(rect.width),h:Math.round(rect.height)};(event.target as HTMLElement).setPointerCapture(event.pointerId);}
// The overlay keeps the shell centered, so a corner drag moves half the size delta.
function onDialogResizeMove(event:PointerEvent){if(dialogResizeStart?.pointer!==event.pointerId)return;dialogSize.value={w:clampDialogW(dialogResizeStart.w+(event.clientX-dialogResizeStart.x)*2),h:clampDialogH(dialogResizeStart.h+(event.clientY-dialogResizeStart.y)*2)};}
function onDialogResizeEnd(event:PointerEvent){if(dialogResizeStart?.pointer!==event.pointerId)return;dialogResizeStart=null;saveDialogSize();}
const dialogStyle=computed(()=>{
  if(pickerOpen.value)return{width:pickerViewMode.value==='table'?'min(1400px,calc(100vw - 32px))':'min(700px,calc(100vw - 32px))'};
  if(dialogSize.value)return{width:`${dialogSize.value.w}px`,height:`${dialogSize.value.h}px`,maxHeight:'calc(100vh - 32px)'};
  return{width:'min(700px,calc(100vw - 32px))'};
});
const pluginCommandPlugins = shallowRef<ManagedPluginEntry[]>([]);
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
  const categories=query||pickerViewMode.value==='table'
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
const dialogTitle=computed(()=>pickerOpen.value?t('eventcmd.title'):commandTitle.value||(editSpan.value!=null?t('eventcmd.editTitle'):t('eventcmd.newTitle')));
const commandTitle=computed(()=>{
  if (!draft.value) return '';
  const definition = commandDefinition(draft.value.code,currentEngine.value);
  return definition ? localizeCommandLabel(definition, language.value) : t('eventcmd.unknownCommand', { code: draft.value.code });
});
const routeParam=computed<MvMoveRoute>(()=>(draft.value?.parameters[1] as MvMoveRoute)||defaultMoveRoute());
// The guide line is measured against the rendered textarea instead of trusting
// the dialog's nominal width. This keeps it inside the actual UI area when a
// project uses a wide screen or the dialog has been resized.
const textFaceName=computed(()=>draft.value?.code===101?String(draft.value.parameters[0]||''):'');
function measureTextGuide(){
  const wrap=textInputWrapRef.value;
  const area=textAreaRef.value;
  if(!wrap||!area){measuredTextGuideLeft.value=0;return;}
  const wrapWidth=Math.max(0,wrap.getBoundingClientRect().width);
  const areaWidth=Math.max(0,Math.min(area.getBoundingClientRect().width,area.clientWidth||area.getBoundingClientRect().width));
  const measuredWidth=Math.max(0,Math.min(wrapWidth,areaWidth));
  const uiAreaWidth=Number(props.catalog?.uiAreaWidth);
  if(!Number.isInteger(uiAreaWidth)||uiAreaWidth<=0){measuredTextGuideLeft.value=0;return;}
  const reserved= draft.value?.code===101&&textFaceName.value ? 168 : 0;
  const usableGameWidth=Math.max(0,uiAreaWidth-36-reserved);
  const css=window.getComputedStyle(area);
  const textareaFontSize=Number.parseFloat(css.fontSize);
  if(!Number.isFinite(textareaFontSize)||textareaFontSize<=0){measuredTextGuideLeft.value=0;return;}
  // RMMV's message text is measured at the native 28px font. Map that
  // logical width into the measured textarea's actual font/padding box.
  const inlineInset=area.offsetLeft+area.clientLeft+(Number.parseFloat(css.paddingLeft)||0);
  const target=inlineInset+(usableGameWidth*textareaFontSize/28);
  const maxGuide=Math.max(0,Math.min(Math.max(0,wrapWidth-1),area.offsetLeft+measuredWidth-1));
  measuredTextGuideLeft.value=Math.round(Math.max(0,Math.min(maxGuide,target)));
}
function scheduleTextGuideMeasure(){void nextTick(measureTextGuide);}
const textGuideLeft=computed(()=>measuredTextGuideLeft.value);
// Scroll text spans the full screen width, but uses the same measured/clamped
// pixel slot as the message editor because only one of these templates is mounted.
const scrollGuideLeft=computed(()=>measuredTextGuideLeft.value);
const enabledPluginEntries=computed(()=>pluginCommandPlugins.value.filter((plugin)=>plugin.status&&plugin.fileExists&&plugin.name));
const pluginHintMatchesEngine=(hint:PluginCommandHint)=>currentEngine.value==='rpg-maker-mz'?hint.source==='mz-command-header':hint.source!=='mz-command-header';
// The plugin dropdown only lists plugins that actually expose commands for this engine.
const commandCapablePluginEntries=computed(()=>enabledPluginEntries.value.filter((plugin)=>(plugin.commandHints||[]).some(pluginHintMatchesEngine)));
const visiblePluginCommandHints=computed(()=>enabledPluginEntries.value
  .filter((plugin)=>!pluginCommandPlugin.value||plugin.name===pluginCommandPlugin.value)
  .flatMap((plugin)=>plugin.commandHints||[])
  .filter(pluginHintMatchesEngine));
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
watch(currentPickerItems,()=>{activePickerIndex.value=currentPickerItems.value.length?0:-1;});
watch([visible,()=>draft.value?.code,textFaceName,()=>props.catalog?.uiAreaWidth],()=>scheduleTextGuideMeasure());

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.commandDialog)) return;
  event.preventDefault();
  close();
}
onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', scheduleTextGuideMeasure);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('resize', scheduleTextGuideMeasure);
});

function openPicker(at:number, indent=0){pickerOpen.value=true;pickerPage.value=1;pickerQuery.value='';activePickerIndex.value=0;draft.value=null;draftSpan.value=[];elseBranchEnabled.value=false;conditionalTypeDrafts.value={};insertSpan.value=at;insertIndent.value=indent;editSpan.value=null;visible.value=true;void nextTick(()=>pickerSearchRef.value?.focus());}
// Keep in sync with the bespoke editor templates dispatched by draft.code above.
const CUSTOM_EDITOR_CODES=new Set([101,102,103,104,105,108,111,124,138,205,223,224,225,234,236,302,322,323,355,356,357]);
// RM inserts parameterless commands directly; no editor page is shown for them.
function commandHasNoEditorParams(code:number){
  if(CUSTOM_EDITOR_CODES.has(code))return false;
  const definition=commandDefinition(code,currentEngine.value);
  return definition!=null&&definition.fields.length===0;
}
function openEditor(commands:MvCommand[],index:number){
  const nextSpan=clone(commands);
  if(nextSpan[0]?.code===111){
    try{
      validateConditionalBranchParameters(nextSpan[0].parameters,currentEngine.value);
      if(nextSpan.length>1)inspectConditionalBranchSpan(nextSpan,currentEngine.value);
    }catch(error){
      ElMessage.error(`${t('eventcmd.invalidConditional')}: ${(error as Error).message}`);
      return;
    }
  }
  draftSpan.value=nextSpan;draft.value=draftSpan.value[0];if(draft.value)normalizeEventCommandParameters(draft.value,currentEngine.value);if(draft.value?.code===111)initializeConditionalTypeDraft();if(draft.value&&commandHasNoEditorParams(draft.value.code)){draft.value=null;draftSpan.value=[];conditionalTypeDrafts.value={};return;}editSpan.value=index;insertSpan.value=null;insertIndent.value=draft.value?.indent||0;if(draft.value?.code===205){openMergedRouteDialog();return;}pickerOpen.value=false;batchInput.value=false;syncMultiText();syncChoiceText();syncShopGoods();syncCondState();syncConditionalBranchState();syncGpRangeMode();syncPluginCommandSelection();visible.value=true;void nextTick(measureTextGuide);if([356,357].includes(draft.value?.code??0))void loadPluginCommandMetadata();loadDialogSize(draft.value?.code??0);if([101,322,323].includes(draft.value?.code??0))void nextTick(paintImagePreviews);
}
function pick(kind:string){draftSpan.value=applyCommandIndent(commandTemplate(kind,props.mapId??1,currentEngine.value),insertIndent.value);draft.value=draftSpan.value[0];if(draft.value)normalizeEventCommandParameters(draft.value,currentEngine.value);if(draft.value?.code===111)initializeConditionalTypeDraft();if(draft.value&&commandHasNoEditorParams(draft.value.code)){commit();return;}if(draft.value?.code===205){openMergedRouteDialog();return;}pickerOpen.value=false;batchInput.value=false;syncMultiText();syncChoiceText();syncShopGoods();syncCondState();syncConditionalBranchState();syncGpRangeMode();syncPluginCommandSelection();void nextTick(measureTextGuide);if(draft.value?.code===356||draft.value?.code===357)void loadPluginCommandMetadata();loadDialogSize(draft.value?.code??0);if([101,322,323].includes(draft.value?.code??0))void nextTick(paintImagePreviews);}
// Set Movement Route (205) merges the target dropdown into the route editor: the
// command dialog shell never shows, MoveRouteDialog commits or cancels the draft.
function openMergedRouteDialog(){pickerOpen.value=false;visible.value=false;const current=numberParam(0,0);routeDialog.value?.open(routeParam.value,{target:current,targetOptions:moveRouteTargetOptions(current)});}
function moveRouteTargetOptions(current:number):[number,string][]{
  const options:[number,string][]=[[0,t('cmdFields.thisEvent')],[-1,t('cmdFields.player')]];
  const seen=new Set<number>();
  for(const event of [...(props.currentEvents||[])].sort((left,right)=>left.id-right.id)){
    if(!Number.isInteger(event.id)||event.id<=0||seen.has(event.id))continue;
    seen.add(event.id);
    options.push([event.id,t('cmdFields.mapEvent',{id:String(event.id).padStart(3,'0'),name:event.name})]);
  }
  if(Number.isFinite(current)&&!options.some(([value])=>value===current)){
    options.unshift([current,current>0?t(props.currentEvents?'cmdFields.missingEvent':'cmdFields.eventReference',{id:String(current).padStart(3,'0')}):t('cmdFields.unavailableTarget',{id:String(current)})]);
  }
  return options;
}
function cancelMergedRoute(){if(draft.value?.code===205&&!visible.value)close();}
function close(){visible.value=false;pickerOpen.value=false;pickerQuery.value='';draft.value=null;draftSpan.value=[];elseBranchEnabled.value=false;conditionalTypeDrafts.value={};}
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
function commit(){
  if(!draft.value)return;
  if(draft.value.code===102){
    // Compact one choice per line; blank lines are ignored, while overflow and
    // stale default/cancel indices remain explicit errors.
    const choices=choiceLines.value;
    if(choiceError.value){ElMessage.error(choiceError.value);return;}
    draft.value.parameters[0]=choices;
  }
  if(draft.value.code===302){
    // RM's head command stores the first goods row; an empty list is a hard error.
    if(!shopGoods.value.length){ElMessage.error(t('eventcmd.shopEmpty'));return;}
    const first=shopGoods.value[0];
    draft.value.parameters[0]=first.goodsType;draft.value.parameters[1]=first.id;
    draft.value.parameters[2]=first.priceType;draft.value.parameters[3]=first.price;
    draft.value.parameters[4]=Boolean(draft.value.parameters[4]);
  }
  let commands:MvCommand[];
  try{commands=buildSpan();}
  catch(error){ElMessage.error(`${t('eventcmd.invalidConditional')}: ${(error as Error).message}`);return;}
  emit('commit',{commands,editSpan:editSpan.value,insertSpan:insertSpan.value});close();
}
function buildSpan(){
  if(!draft.value)return[];
  if(draft.value.code===101)return batchInput.value?buildBatchTextSpan():[clone(draft.value),...splitText(401)];
  if(draft.value.code===105)return [clone(draft.value),...splitText(405)];
  if(draft.value.code===108)return splitText(108,408);
  if(draft.value.code===205)return [clone(draft.value),...routeParam.value.list.filter((step)=>step.code!==0).map((step)=>({code:505,indent:draft.value!.indent,parameters:[clone(step)]}))];
  if(draft.value.code===355)return splitText(355,655);
  if(draft.value.code===357)return [clone(draft.value),...Object.entries(currentMZPluginArguments.value).map(([name,value])=>({code:657,indent:draft.value!.indent,parameters:[`${name} = ${value}`]}))];
  if(draft.value.code===102)return editSpan.value==null?buildChoiceBlock():buildChoiceEditSpan();
  if(draft.value.code===302)return [clone(draft.value),...shopGoods.value.slice(1).map((entry)=>({code:605,indent:draft.value!.indent,parameters:[entry.goodsType,entry.id,entry.priceType,entry.price]}))];
  if(draft.value.code===111){
    return applyConditionalBranchElse(draftSpan.value.length?draftSpan.value:[draft.value],elseBranchEnabled.value,currentEngine.value) as MvCommand[];
  }
  return clone(draftSpan.value.length?draftSpan.value:[draft.value]);
}
function buildChoiceBlock(){
  const head=clone(draft.value!);
  const choices=Array.isArray(head.parameters[0])?(head.parameters[0] as unknown[]).map((choice)=>String(choice??'')):[];
  const span:MvCommand[]=[head,...choices.map((choice,index)=>({code:402,indent:head.indent,parameters:[index,choice]}))];
  if(Number(head.parameters[1])===-2)span.push({code:403,indent:head.indent,parameters:[]});
  span.push({code:404,indent:head.indent,parameters:[]});
  return span;
}
// Editing Show Choices rebuilds the 402/403 skeleton while keeping branch bodies:
// same-text branches are reused first, leftovers are matched by position (rename case),
// removed choices drop their branch, and the 403 cancel branch follows cancelType === -2.
function buildChoiceEditSpan(){
  const head=clone(draft.value!);
  const headIndent=head.indent;
  const oldBranches:{text:string;body:MvCommand[]}[]=[];
  let cancelBody:MvCommand[]|null=null;
  let current:MvCommand[]|null=null;
  for(const command of draftSpan.value.slice(1)){
    if(command.indent===headIndent&&(command.code===402||command.code===403||command.code===404)){
      if(command.code===402){current=[];oldBranches.push({text:String(command.parameters[1]??''),body:current});}
      else if(command.code===403){current=[];cancelBody=current;}
      else current=null;
    }else if(current){
      current.push(clone(command));
    }
  }
  const choices=Array.isArray(head.parameters[0])?(head.parameters[0] as unknown[]).map((choice)=>String(choice??'')):[];
  const used=new Set<number>();
  const picks=choices.map((choice)=>{
    const index=oldBranches.findIndex((branch,i)=>!used.has(i)&&branch.text===choice);
    if(index<0)return null;
    used.add(index);
    return oldBranches[index];
  });
  for(let i=0;i<picks.length;i+=1){
    if(picks[i])continue;
    const index=oldBranches.findIndex((_,j)=>!used.has(j));
    if(index<0)break;
    used.add(index);
    picks[i]=oldBranches[index];
  }
  const span:MvCommand[]=[head];
  choices.forEach((choice,index)=>{
    span.push({code:402,indent:headIndent,parameters:[index,choice]});
    span.push(...(picks[index]?.body||[]));
  });
  if(Number(head.parameters[1])===-2){
    span.push({code:403,indent:headIndent,parameters:[]});
    span.push(...(cancelBody||[]));
  }
  span.push({code:404,indent:headIndent,parameters:[]});
  return span;
}
// RM-native batch entry: every 4 lines of text become one 101+401xN message span.
function buildBatchTextSpan(){
  const lines=multiText.value.split(/\r?\n/);
  const span:MvCommand[]=[];
  for(let start=0;start<lines.length;start+=4){
    span.push(clone(draft.value!));
    for(const line of lines.slice(start,start+4))span.push({code:401,indent:draft.value!.indent,parameters:[line]});
  }
  return span;
}
function splitText(firstCode:number,nextCode=firstCode){const lines=multiText.value.split(/\r?\n/);return lines.map((line,index)=>({code:index?nextCode:firstCode,indent:draft.value?.indent||0,parameters:[line]}));}
function syncMultiText(){if(!draft.value)return;multiText.value=draft.value.code===101||draft.value.code===105?draftSpan.value.slice(1).map((item)=>String(item.parameters[0]||'')).join('\n'):draft.value.code===108||draft.value.code===355?draftSpan.value.map((item)=>String(item.parameters[0]||'')).join('\n'):String(draft.value.parameters[0]||'');}
function touchCommand(){if(draft.value)normalizeEventCommandParameters(draft.value,currentEngine.value);}
function setParam(index:number,value:unknown){if(draft.value){draft.value.parameters[index]=value;if((draft.value.code===356&&index===0)||(draft.value.code===357&&(index===0||index===1)))syncPluginCommandSelection();touchCommand();}}
function numberParam(index:number,fallback=0){return Number(draft.value?.parameters[index]??fallback);}
function rawChoiceParam(index:number,fallback=-1):unknown{return draft.value?.parameters[index]??fallback;}
function stringParam(index:number,fallback=''){return String(draft.value?.parameters[index]??fallback);}
function boolParam(index:number,fallback=false){return Boolean(draft.value?.parameters[index]??fallback);}
function syncChoiceText(){const choices=draft.value?.code===102&&Array.isArray(draft.value.parameters[0])?draft.value.parameters[0] as unknown[]:[];choiceText.value=choices.map((choice)=>String(choice??'').trim()).filter(Boolean).join('\n');}
// Shop rows live in [head params, ...605 params]; every row is [goodsType, id, priceType, price].
function syncShopGoods(){
  shopGoodsIndex.value=null;shopGoodsEditIndex.value=null;
  if(draft.value?.code!==302){shopGoods.value=[];return;}
  const rows=[draft.value.parameters,...draftSpan.value.slice(1).filter((item)=>item.code===605).map((item)=>item.parameters)];
  shopGoods.value=rows.map((p)=>({goodsType:Number(p[0])||0,id:Number(p[1])||0,priceType:Number(p[2])===1?1:0,price:Number(p[3])||0}));
}
function shopGoodsName(entry:ShopGoodsEntry){
  const source=entry.goodsType===1?props.catalog?.weapons:entry.goodsType===2?props.catalog?.armors:props.catalog?.items;
  const found=(source||[]).find((item)=>item.id===entry.id);
  return `${String(entry.id).padStart(4,'0')} ${found?.name??'?'}`;
}
function addShopGoods(){shopGoodsEditIndex.value=null;shopGoodsDialog.value?.open({goodsType:0,id:props.catalog?.items[0]?.id??1,priceType:0,price:0});}
function editShopGoods(index:number){if(index<0||index>=shopGoods.value.length)return;shopGoodsIndex.value=index;shopGoodsEditIndex.value=index;shopGoodsDialog.value?.open(shopGoods.value[index]);}
function removeShopGoods(){if(shopGoodsIndex.value==null)return;shopGoods.value.splice(shopGoodsIndex.value,1);shopGoodsIndex.value=null;}
function commitShopGoods(entry:ShopGoodsEntry){
  if(shopGoodsEditIndex.value==null){shopGoods.value.push(entry);shopGoodsIndex.value=shopGoods.value.length-1;}
  else{shopGoods.value[shopGoodsEditIndex.value]=entry;shopGoodsIndex.value=shopGoodsEditIndex.value;}
  shopGoodsEditIndex.value=null;
}
function openTextFacePicker(){pendingImageTarget.value={nameIndex:0,indexIndex:1};imagePicker.value?.open({asset:'faces',mode:'face',title:t('eventcmd.chooseFace'),name:stringParam(0),index:numberParam(1)});}
function openActorImagePicker(slot:'face'|'character'|'battler'){const s=actorImageSlots.value;if(slot==='face'){pendingImageTarget.value={nameIndex:s.face,indexIndex:s.faceIndex};imagePicker.value?.open({asset:'faces',mode:'face',title:t('eventcmd.chooseFace'),name:stringParam(s.face),index:numberParam(s.faceIndex)});}else if(slot==='character'){pendingImageTarget.value={nameIndex:s.character,indexIndex:s.characterIndex};imagePicker.value?.open({asset:'characters',mode:'character',name:stringParam(s.character),index:numberParam(s.characterIndex)});}else{pendingImageTarget.value={nameIndex:s.battler};imagePicker.value?.open({asset:'svActors',mode:'plain',name:stringParam(s.battler)});}}
function openVehicleImagePicker(){pendingImageTarget.value={nameIndex:1,indexIndex:2};imagePicker.value?.open({asset:'characters',mode:'character',name:stringParam(1),index:numberParam(2)});}
async function assetImage(kind:'faces'|'characters'|'svActors',name:string){if(!name)return null;const asset=props.catalog?.assets[kind].find((entry)=>entry.name===name);return asset?await props.loadImage(asset.url):null;}
function cellContext(el?:HTMLCanvasElement){if(!el)return null;const ctx=el.getContext('2d');if(!ctx)return null;ctx.clearRect(0,0,el.width,el.height);ctx.imageSmoothingEnabled=false;return ctx;}
async function paintFaceCell(){const el=faceCellRef.value,ctx=cellContext(el);if(!el||!ctx)return;const s=actorImageSlots.value;const img=await assetImage('faces',stringParam(s.face));if(!img)return;const source=mvFaceSourceRect(numberParam(s.faceIndex),faceSize.value);ctx.drawImage(img,source.sx,source.sy,source.sw,source.sh,0,0,el.width,el.height);}
// Standing frame: middle pattern facing down, drawn at the largest integer scale that fits.
async function paintCharCell(){const el=charCellRef.value,ctx=cellContext(el);if(!el||!ctx)return;const is323=draft.value?.code===323;const s=actorImageSlots.value;const name=stringParam(is323?1:s.character),index=numberParam(is323?2:s.characterIndex);const img=await assetImage('characters',name);if(!img)return;const big=isBigCharacterName(name);const pw=img.naturalWidth/(big?3:12),ph=img.naturalHeight/(big?4:8);if(!(pw>0&&ph>0))return;const sx=Math.floor(((big?0:(index%4)*3)+1)*pw),sy=Math.floor((big?0:Math.floor(index/4)*4)*ph),sw=Math.floor(pw),sh=Math.floor(ph);const scale=Math.max(1,Math.floor(Math.min(el.width/sw,el.height/sh)));ctx.drawImage(img,sx,sy,sw,sh,Math.floor((el.width-sw*scale)/2),Math.floor((el.height-sh*scale)/2),sw*scale,sh*scale);}
async function paintBattlerCell(){const el=battlerCellRef.value,ctx=cellContext(el);if(!el||!ctx)return;const img=await assetImage('svActors',stringParam(actorImageSlots.value.battler));if(!img)return;const sw=Math.floor(img.naturalWidth/9),sh=Math.floor(img.naturalHeight/6);if(!(sw>0&&sh>0))return;const scale=Math.max(1,Math.floor(Math.min(el.width/sw,el.height/sh)));ctx.drawImage(img,0,0,sw,sh,Math.floor((el.width-sw*scale)/2),Math.floor((el.height-sh*scale)/2),sw*scale,sh*scale);}
async function paintImagePreviews(){if(draft.value?.code===101){await paintFacePreview();return;}if(draft.value?.code===322){await paintFaceCell();await paintCharCell();await paintBattlerCell();return;}if(draft.value?.code===323)await paintCharCell();}
function variableDisplay(id:number){return namedEntryDisplay('variable',id);}
function openVariableSelector(index:number){openNamedEntry('variable',index);}
function commitNamedEntrySelection(payload:{kind:string;id:number}){
  const pending=pendingNamedEntry.value;
  if(payload.kind!==pending.kind)return;
  if(pending.conditionType!==null){
    if(!visible.value||draft.value?.code!==111||activeConditionalType()!==pending.conditionType)return;
    if(!isConditionalNamedEntryTarget(draft.value.parameters,pending.kind,pending.index))return;
  }
  const index=pending.index;
  const conditionType=numberParam(0);
  const isCode111NamedId=draft.value?.code===111&&(
    (index===1&&(conditionType===0||conditionType===1))
    ||(index===3&&conditionType===1&&numberParam(2)===1)
  );
  if(isCode111NamedId&&!isFinitePositiveInteger(payload.id)){
    ElMessage.error(t('eventcmd.invalidEntryId'));
    return;
  }
  setParam(index,payload.id);
  if(pending.mirror!=null)setParam(pending.mirror,payload.id);
}
function openScrollPreview(){if(!draft.value)return;scrollPreview.value?.open({lines:multiText.value.split(/\r?\n/),speed:numberParam(0,2)});}
function commitImageSelection(selection:{name:string;index:number}){const target=pendingImageTarget.value;if(!target)return;setParam(target.nameIndex,selection.name);if(target.indexIndex!=null)setParam(target.indexIndex,selection.name?selection.index:0);void nextTick(paintImagePreviews);}
function openMessagePreview(){if(!draft.value)return;messagePreview.value?.open({faceName:stringParam(0),faceIndex:numberParam(1),background:numberParam(2),positionType:numberParam(3,2),lines:multiText.value.split(/\r?\n/).slice(0,4)});}
// Empty/missing faces leave the canvas transparent so the CSS checkerboard shows through.
async function paintFacePreview(){const el=facePreviewRef.value;if(!el)return;const w=el.width,h=el.height,ctx=el.getContext('2d')!;ctx.clearRect(0,0,w,h);ctx.imageSmoothingEnabled=false;const faceName=stringParam(0);if(!faceName)return;const asset=props.catalog?.assets.faces.find(e=>e.name===faceName);if(!asset)return;const img=await props.loadImage(asset.url);if(!img)return;const source=mvFaceSourceRect(numberParam(1),faceSize.value);ctx.drawImage(img,source.sx,source.sy,source.sw,source.sh,0,0,w,h);}
function setRoute(route:MvMoveRoute,target:number|null){if(!draft.value)return;if(target!=null)setParam(0,target);setParam(1,route);if(draft.value.code===205&&!visible.value)commit();}
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
function selectPluginForCommand(name:string){
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
function pluginCommandHintLabel(hint:PluginCommandHint):string{
  const displayName=String(hint.displayName||'').trim();
  const command=String(hint.command||'').trim();
  return displayName&&displayName!==command?`${displayName} · ${command}`:(displayName||command);
}
function pluginArgumentTypeLabel(argument:PluginCommandArgument):string{
  return formatPluginParameterTypeLabel(argument.rawType, argument.kind, t);
}
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
// Complex argument values reuse the plugin manager's value editor dialog.
const pluginArgumentEditorOpen=ref(false);
const pluginArgumentEditing=shallowRef<PluginCommandArgument|null>(null);
function openPluginArgumentEditor(argument:PluginCommandArgument){
  if(argument.kind==='boolean')return;
  pluginArgumentEditing.value=argument;
  pluginArgumentEditorOpen.value=true;
}
function commitPluginArgumentValue(value:unknown){
  const argument=pluginArgumentEditing.value;
  if(argument)setMZPluginArgument(argument,value);
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
.ev-modal-overlay{z-index:v-bind(commandDialogZ);background:transparent}
.cmd-dialog{
  position:relative;
  height:auto;
  max-height:min(850px,calc(100vh - 32px))
}
.dialog-resize-handle{position:absolute;right:2px;bottom:2px;width:14px;height:14px;border-radius:2px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 0 45%,var(--app-border-strong) 45% 55%,transparent 55% 68%,var(--app-border-strong) 68% 78%,transparent 78%)}
  .picker-shell{
    min-height:0;
    display:flex;
    flex-direction:column;
  }.picker-modebar{display:flex;align-items:center;justify-content:space-between;gap:0px;padding:8px 12px 0}.picker-modebar-spacer{flex:1}.command-page-tabs button{min-width:36px}
  .picker-view-toggle{
    display:flex;
    width: 100%;
    justify-content: end;
  }.picker-view-toggle button{white-space:nowrap}.picker-search{display:grid;gap:5px;padding:8px 12px;color:var(--app-ink-soft);font-size:12px}.picker-search input{width:100%;min-height:32px}
.picker{
  min-height:0;
  align-items:start;
  gap:12px;
  padding:0 12px 12px;
  overflow:auto;
}

.picker--table{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.picker-group{
  padding:7px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg-soft);
  align-self: stretch;
  margin-bottom: 10px;
  break-inside: avoid;
}
.picker-group:last-child{
  height: 100%;
  margin-bottom: 0px;
}
.text-cmd-label {
  display: inline-flex;
  margin: 4px;
  color: var(--app-ink-soft);
  font-size: 12px;
}
.picker h4{margin:0 0 5px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--app-ink);font-size:12px}.picker h4 small{color:var(--app-ink-muted);font-size:10px;font-weight:500}.picker-group div{display:grid;gap:3px}.picker button{min-height:28px;padding:3px 8px;border:1px solid var(--app-border-strong);border-radius:2px;background:linear-gradient(var(--app-bg),var(--app-bg-sunken));color:var(--app-ink);cursor:pointer;font-size:12px;text-align:left}.picker button:hover,.picker button.active{border-color:var(--app-accent);background:var(--app-accent-soft)}.picker button:focus-visible{outline:2px solid var(--app-accent);outline-offset:1px}.picker-empty{grid-column:1 / -1;margin:16px 0;padding:16px;border:1px dashed var(--app-border);border-radius:var(--app-radius-sm);color:var(--app-ink-muted);font-size:12px;text-align:center}.editor-body{flex:1 1 auto;min-height:0;padding:12px;overflow:auto}.fields{display:flex;flex-wrap:wrap;gap:8px}.fields>label{min-width:145px;display:grid;gap:4px;color:var(--app-ink-soft);font-size:12px}.fields .full{width:100%}input:not([type=checkbox]),select,textarea{min-width:0;padding:5px 6px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg);color:var(--app-ink);font-size:13px}textarea{font-family:var(--app-font-mono);resize:vertical}.inline,.route-field{display:flex;align-items:center;gap:5px}.inline input{min-width:0;flex:1}.route-field{min-width:230px;justify-content:space-between;color:var(--app-ink-muted);font-size:12px}.check{display:flex!important;grid-template-columns:auto 1fr!important;align-items:center}.form-note{width:100%;margin:0;color:var(--app-ink-muted);font-size:12px;line-height:1.5}.unsupported-command{padding:10px;border:1px dashed var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg-soft)}
.plugin-command-editor{width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.plugin-command-editor label{min-width:0;display:grid;gap:4px;color:var(--app-ink-soft);font-size:12px}.plugin-command-editor .full{grid-column:1 / -1}.plugin-command-editor textarea{min-height:96px}.plugin-command-warning{grid-column:1 / -1;padding:8px 10px;border-radius:var(--app-radius-sm);background:var(--app-warn-soft);color:var(--app-warn);font-size:12px;line-height:1.45}
.plugin-command-name-row{display:flex;align-items:center;gap:8px;color:var(--app-ink-soft);font-size:12px}.plugin-command-name{max-width:100%;overflow:hidden;font-family:var(--app-font-mono);text-overflow:ellipsis}
.plugin-args-wrap{max-height:320px;overflow:auto;border:1px solid var(--app-border-strong);border-radius:var(--app-radius-sm)}
.plugin-args-table{width:100%;border-collapse:collapse;background:var(--app-bg);font-size:12px}.plugin-args-table th{position:sticky;top:0;padding:5px 8px;background:var(--app-bg-soft);color:var(--app-ink-soft);font-weight:600;text-align:left}.plugin-args-table td{padding:5px 8px;border-top:1px solid var(--app-border);vertical-align:middle}.plugin-args-table tbody tr{cursor:default}.plugin-args-table tbody tr:hover{background:var(--app-bg-soft)}
.plugin-arg-name{width:32%}.plugin-arg-name span{display:block;color:var(--app-ink)}.plugin-arg-name small{display:block;overflow:hidden;color:var(--app-ink-muted);font-size:11px;line-height:1.35;text-overflow:ellipsis;white-space:nowrap}.plugin-arg-key{width:22%;font-family:var(--app-font-mono);color:var(--app-ink-muted)}.plugin-arg-key code{font:inherit;overflow-wrap:anywhere}.plugin-arg-type{width:18%;color:var(--app-ink-muted);white-space:nowrap}
.plugin-arg-value{color:var(--app-ink)}.plugin-arg-value .plugin-arg-preview{display:inline-block;max-width:calc(100% - 40px);overflow:hidden;font-family:var(--app-font-mono);text-overflow:ellipsis;vertical-align:middle;white-space:nowrap}.plugin-arg-edit{min-width:28px;margin-left:6px;padding:1px 6px}
.plugin-option-name{float:left;max-width:55%;overflow:hidden;text-overflow:ellipsis}.plugin-option-desc{float:right;max-width:42%;overflow:hidden;color:var(--app-ink-muted);font-size:12px;text-overflow:ellipsis}
.text-cmd-layout{width:100%;display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start}.text-cmd-face{display:flex;flex-direction:column;align-items:flex-start;gap:4px;color:var(--app-ink-soft);font-size:12px}.text-cmd-face .editor-btn{align-self:center}.face-preview{width:144px;height:144px;border:1px solid var(--app-border-strong);border-radius:var(--app-radius-sm);cursor:pointer;image-rendering:pixelated;background-color:#f5efe6;background-image:linear-gradient(45deg,#ded6c8 25%,transparent 25%),linear-gradient(-45deg,#ded6c8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ded6c8 75%),linear-gradient(-45deg,transparent 75%,#ded6c8 75%);background-position:0 0,0 6px,6px -6px,-6px 0;background-size:12px 12px}.text-cmd-text{display:grid;gap:4px;color:var(--app-ink-soft);font-size:12px}.text-cmd-input-wrap{position:relative;display:block}.text-cmd-input-wrap textarea{width:100%;min-height:144px;box-sizing:border-box}.text-guide-line{position:absolute;top:1px;bottom:1px;width:1px;background:var(--app-border-strong);pointer-events:none}.text-cmd-options{width:100%;display:flex;gap:12px;margin-top:4px;align-items:flex-end}.text-cmd-preview{margin-left:auto}.text-cmd-batch{width:100%;margin-top:2px;gap:5px}
.choice-cmd-layout{width:100%;display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:16px;align-items:start}.choice-cmd-list{display:grid;gap:6px}.choice-cmd-title{color:var(--app-ink-soft);font-size:12px;font-weight:600}.choice-cmd-text{display:grid;gap:4px;color:var(--app-ink-soft);font-size:12px}.choice-cmd-text textarea{width:100%;min-height:150px;box-sizing:border-box;resize:vertical}.choice-cmd-hint{color:var(--app-ink-muted);font-size:11px;line-height:1.4}.choice-cmd-warning{margin:0;padding:6px 8px;border-radius:var(--app-radius-sm);background:var(--app-warn-soft);color:var(--app-warn);font-size:11px;line-height:1.4}.choice-cmd-row{display:flex;align-items:center;gap:6px;color:var(--app-ink-soft);font-size:12px}.choice-cmd-row span{flex:0 0 24px;text-align:right}.choice-cmd-row input{flex:1;min-width:0}.choice-cmd-side{display:grid;gap:8px;align-content:start}.choice-cmd-side label{display:grid;gap:4px;color:var(--app-ink-soft);font-size:12px}
.var-cmd-field{width:100%;max-width:280px;display:grid;gap:4px;color:var(--app-ink-soft);font-size:12px}.var-cmd-field .text-cmd-label{margin:0}.var-cmd-row{display:flex;gap:6px}.var-cmd-row input{flex:1;min-width:0;cursor:pointer}.var-cmd-row .editor-btn{flex:0 0 auto;min-width:32px}
.scroll-cmd-options{width:100%;display:flex;gap:12px;margin-top:4px;align-items:center}.scroll-cmd-speed{display:flex!important;align-items:center;gap:6px}.scroll-cmd-speed input{width:64px}.scroll-cmd-preview{margin-left:auto}
.shop-cmd-layout{width:100%;display:grid;gap:8px}.shop-goods-table{width:100%;border-collapse:collapse;border:1px solid var(--app-border-strong);background:var(--app-bg);font-size:12px}.shop-goods-table th{background:var(--app-bg-soft);color:var(--app-ink-soft);font-weight:600}.shop-goods-table th,.shop-goods-table td{padding:4px 8px;border-bottom:1px solid var(--app-border);text-align:left}.shop-price-col{width:110px;text-align:right}.shop-goods-table tbody tr{cursor:default;user-select:none}.shop-goods-table tbody tr.active{background:var(--app-accent-soft)}.shop-goods-empty td{height:26px}.shop-goods-table:focus-visible{outline:2px solid var(--app-accent);outline-offset:1px}
.cond-cmd-layout{width:100%;display:grid;gap:8px}.cond-tabs{display:flex;gap:2px}.cond-tabs button{min-width:36px}.cond-tab{display:grid;gap:6px}.cond-row{display:flex;align-items:center;gap:8px}.cond-row.cond-sub{padding-left:26px}.cond-row.inactive{opacity:.4}.cond-pick{flex:0 0 128px;display:flex;align-items:center;gap:5px;color:var(--app-ink);font-size:12px}.cond-sub .cond-pick{flex-basis:102px}.cond-main{flex:1;min-width:0}.cond-inline{display:flex;align-items:center;gap:5px}.cond-inline input{width:64px}.cond-unit{color:var(--app-ink-soft);font-size:12px}.cond-check{flex:0 0 auto;gap:5px}.cond-else{width:100%;margin-top:4px;gap:5px}
.cond-group{margin:0;padding:8px 10px 10px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);display:grid;gap:6px}.cond-group legend{padding:0 4px;color:var(--app-ink-soft);font-size:12px}.cond-radios{flex-wrap:wrap;gap:12px}.cond-radios label{display:flex;align-items:center;gap:5px;color:var(--app-ink);font-size:12px}.gp-gamedata select{flex:1;min-width:0}.gp-gamedata input{width:72px}
.tone-group{width:100%}.dur-row{width:100%;display:flex;align-items:center;gap:8px}.dur-row input[type=number]{width:72px}.dur-row .check{margin-left:12px;gap:5px}
.img-cell-row{width:100%;display:flex;gap:14px}.img-cell{display:grid;gap:4px;justify-items:start;color:var(--app-ink-soft);font-size:12px}.img-cell-canvas{width:96px;height:96px}
</style>
