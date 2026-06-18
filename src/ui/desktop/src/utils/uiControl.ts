export type UiControlCommandType =
  | 'capture-current'
  | 'navigate'
  | 'open-event-editor'
  | 'state'
  | 'click'
  | 'input'
  | 'key'
  | 'read'
  | 'wait';

export type UiControlWaitCondition = 'present' | 'visible' | 'hidden' | 'enabled' | 'disabled' | 'text' | 'value';

export interface UiControlCommand {
  type: UiControlCommandType;
  target?: string;
  mapId?: number;
  eventId?: number;
  label?: string;
  capture?: boolean;
  waitMs?: number;
  timeoutMs?: number;
  selector?: string;
  testId?: string;
  text?: string;
  key?: string;
  condition?: UiControlWaitCondition;
  expect?: string;
  modifiers?: string[];
}

export interface UiControlEnvelope {
  id?: string;
  command?: UiControlCommand;
}

export interface EditorUiControlState {
  mounted: boolean;
  mapId: number | null;
  eventId: number | null;
  eventDialogOpen: boolean;
  mode: string;
  statusText: string;
  statusKind: string;
}

export interface EditorUiControlHandler {
  openEventEditor(mapId: number, eventId: number): Promise<EditorUiControlState>;
  getState(): EditorUiControlState;
}

interface ElementState {
  exists: boolean;
  testId: string;
  tag: string;
  id: string;
  role: string;
  ariaLabel: string;
  title: string;
  placeholder: string;
  text: string;
  value: string | number | boolean | null;
  checked: boolean | null;
  visible: boolean;
  disabled: boolean;
  focused: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

let editorHandler: EditorUiControlHandler | null = null;

export function registerEditorUiControlHandler(handler: EditorUiControlHandler): () => void {
  editorHandler = handler;
  return () => {
    if (editorHandler === handler) editorHandler = null;
  };
}

export async function openEditorEventFromUiControl(mapId: number, eventId: number): Promise<EditorUiControlState> {
  if (!editorHandler) throw new Error('编辑器尚未就绪，无法打开事件编辑界面。');
  return editorHandler.openEventEditor(mapId, eventId);
}

export function getEditorUiControlState(): EditorUiControlState {
  return editorHandler?.getState() || {
    mounted: false,
    mapId: null,
    eventId: null,
    eventDialogOpen: false,
    mode: '',
    statusText: '',
    statusKind: '',
  };
}

export function collectUiControlPageState(): Record<string, unknown> {
  return {
    activeElement: elementState(document.activeElement),
    dialogs: collectElementStates('[role="dialog"], dialog, .settings-dialog, .editor-modal-shell, .ev-modal'),
    alerts: collectElementStates('[role="alert"], .el-alert, .alert, .settings-error-bar, .project-access-state.error'),
    errors: collectElementStates('.settings-error-bar, .alert-error, .identity-error, .project-access-state.error, .fetch-err, .el-message--error'),
  };
}

export async function runDomUiControlCommand(command: UiControlCommand): Promise<Record<string, unknown>> {
  if (command.type === 'click') return clickUiElement(command);
  if (command.type === 'input') return inputUiElement(command);
  if (command.type === 'key') return keyUiElement(command);
  if (command.type === 'read') return readUiElement(command);
  if (command.type === 'wait') return waitForUiElement(command);
  throw new Error(`不支持的 DOM UI 控制命令：${command.type}`);
}

function clickUiElement(command: UiControlCommand): Record<string, unknown> {
  const element = requireTargetElement(command);
  ensureActionableElement(element);
  scrollElementIntoView(element);
  focusElement(element);
  element.click();
  return { action: 'click', target: elementState(element) };
}

function inputUiElement(command: UiControlCommand): Record<string, unknown> {
  const element = requireTargetElement(command);
  ensureActionableElement(element);
  const text = command.text;
  if (typeof text !== 'string') throw new Error('input 命令缺少 text。');
  scrollElementIntoView(element);
  focusElement(element);
  setElementInputValue(element, text);
  return { action: 'input', target: elementState(element) };
}

function keyUiElement(command: UiControlCommand): Record<string, unknown> {
  const element = command.selector || command.testId
    ? requireTargetElement(command)
    : activeHtmlElement() || document.body;
  ensureKeyTarget(element);
  scrollElementIntoView(element);
  focusElement(element);

  const combo = normalizeKeyCombo(command);
  const keydown = new KeyboardEvent('keydown', {
    key: combo.key,
    bubbles: true,
    cancelable: true,
    ctrlKey: combo.ctrlKey,
    shiftKey: combo.shiftKey,
    altKey: combo.altKey,
    metaKey: combo.metaKey,
  });
  const allowed = element.dispatchEvent(keydown);
  if (allowed && combo.key === 'Tab') focusNextTabbable(combo.shiftKey);
  element.dispatchEvent(new KeyboardEvent('keyup', {
    key: combo.key,
    bubbles: true,
    cancelable: true,
    ctrlKey: combo.ctrlKey,
    shiftKey: combo.shiftKey,
    altKey: combo.altKey,
    metaKey: combo.metaKey,
  }));
  return { action: 'key', key: combo.key, modifiers: combo.modifiers, target: elementState(element) };
}

function readUiElement(command: UiControlCommand): Record<string, unknown> {
  const element = requireTargetElement(command);
  return { action: 'read', target: elementState(element) };
}

async function waitForUiElement(command: UiControlCommand): Promise<Record<string, unknown>> {
  const condition = command.condition || 'visible';
  const timeoutMs = clampNumber(command.timeoutMs, 15000, 1000, 60000);
  const started = performance.now();

  if ((condition === 'text' || condition === 'value') && typeof command.expect !== 'string') {
    throw new Error(`wait ${condition} 命令缺少 expect。`);
  }

  while (performance.now() - started <= timeoutMs) {
    const element = findTargetElement(command);
    if (matchesWaitCondition(element, condition, command.expect)) {
      return {
        action: 'wait',
        condition,
        waitedMs: Math.round(performance.now() - started),
        target: elementState(element),
      };
    }
    await delay(80);
  }

  const element = findTargetElement(command);
  throw new Error(`等待 UI 控件超时：${targetDescription(command)} 未满足 ${condition}。当前状态：${JSON.stringify(elementState(element))}`);
}

function matchesWaitCondition(element: Element | null, condition: UiControlWaitCondition, expect: string | undefined): boolean {
  if (condition === 'hidden') return !element || !isElementVisible(element);
  if (!element) return false;
  if (condition === 'present') return true;
  if (condition === 'visible') return isElementVisible(element);
  if (condition === 'enabled') return isElementVisible(element) && !isElementDisabled(element);
  if (condition === 'disabled') return isElementDisabled(element);
  if (condition === 'text') return elementText(element).includes(expect || '');
  if (condition === 'value') return String(elementValue(element) ?? '') === String(expect ?? '');
  return false;
}

function requireTargetElement(command: UiControlCommand): HTMLElement {
  const element = findTargetElement(command);
  if (!element) throw new Error(`找不到 UI 控件：${targetDescription(command)}。`);
  if (!(element instanceof HTMLElement)) throw new Error(`目标控件不是可操作 HTML 元素：${targetDescription(command)}。`);
  return element;
}

function findTargetElement(command: UiControlCommand): Element | null {
  if (command.testId) {
    for (const element of Array.from(document.querySelectorAll('[data-ui-id]'))) {
      if (element.getAttribute('data-ui-id') === command.testId) return element;
    }
    return null;
  }
  if (command.selector) return document.querySelector(command.selector);
  throw new Error('命令缺少 testId 或 selector。');
}

function targetDescription(command: UiControlCommand): string {
  if (command.testId) return `testId=${command.testId}`;
  if (command.selector) return `selector=${command.selector}`;
  return '(未指定目标)';
}

function ensureActionableElement(element: HTMLElement): void {
  if (!isElementVisible(element)) throw new Error(`目标控件不可见：${describeElement(element)}。`);
  if (isElementDisabled(element)) throw new Error(`目标控件已禁用：${describeElement(element)}。`);
}

function ensureKeyTarget(element: HTMLElement): void {
  if (!isElementVisible(element)) throw new Error(`按键目标不可见：${describeElement(element)}。`);
  if (isElementDisabled(element)) throw new Error(`按键目标已禁用：${describeElement(element)}。`);
}

function setElementInputValue(element: HTMLElement, text: string): void {
  if (element instanceof HTMLTextAreaElement) {
    element.value = text;
    dispatchInputEvents(element);
    return;
  }
  if (element instanceof HTMLInputElement) {
    if (['button', 'checkbox', 'file', 'image', 'radio', 'reset', 'submit'].includes(element.type)) {
      throw new Error(`input 命令不能写入 ${element.type} 输入控件。`);
    }
    element.value = text;
    dispatchInputEvents(element);
    return;
  }
  if (element instanceof HTMLSelectElement) {
    element.value = text;
    if (element.value !== text) throw new Error(`下拉控件没有值：${text}。`);
    dispatchInputEvents(element);
    return;
  }
  if (element.isContentEditable) {
    element.textContent = text;
    dispatchInputEvents(element);
    return;
  }
  throw new Error(`目标控件不支持文本输入：${describeElement(element)}。`);
}

function dispatchInputEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

function normalizeKeyCombo(command: UiControlCommand): {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  modifiers: string[];
} {
  const raw = String(command.key || '').trim();
  if (!raw) throw new Error('key 命令缺少 key。');

  const rawParts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  const keyPart = rawParts.length ? rawParts[rawParts.length - 1] : raw;
  const modifierTokens = new Set([
    ...rawParts.slice(0, -1).map(normalizeModifierToken),
    ...(command.modifiers || []).map(normalizeModifierToken),
  ].filter(Boolean));
  const shiftKey = modifierTokens.has('shift');
  const key = normalizeKeyName(keyPart, shiftKey);
  const modifiers = Array.from(modifierTokens).sort();
  return {
    key,
    ctrlKey: modifierTokens.has('ctrl'),
    shiftKey,
    altKey: modifierTokens.has('alt'),
    metaKey: modifierTokens.has('meta'),
    modifiers,
  };
}

function normalizeModifierToken(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'control') return 'ctrl';
  if (normalized === 'cmd' || normalized === 'command' || normalized === 'win' || normalized === 'windows') return 'meta';
  if (['ctrl', 'shift', 'alt', 'meta'].includes(normalized)) return normalized;
  return '';
}

function normalizeKeyName(value: string, shiftKey: boolean): string {
  const key = value.trim();
  const lower = key.toLowerCase();
  if (lower === 'return') return 'Enter';
  if (lower === 'esc') return 'Escape';
  if (lower === 'space' || lower === 'spacebar') return ' ';
  if (lower === 'del') return 'Delete';
  if (lower === 'left') return 'ArrowLeft';
  if (lower === 'right') return 'ArrowRight';
  if (lower === 'up') return 'ArrowUp';
  if (lower === 'down') return 'ArrowDown';
  if (key.length === 1 && !shiftKey) return key.toLowerCase();
  return key;
}

function focusNextTabbable(backward: boolean): void {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(
    'a[href], button, input, textarea, select, details summary, [tabindex]:not([tabindex="-1"])',
  )).filter((element) => isElementVisible(element) && !isElementDisabled(element));
  if (!elements.length) return;
  const active = activeHtmlElement();
  const currentIndex = active ? elements.indexOf(active) : -1;
  const nextIndex = backward
    ? (currentIndex <= 0 ? elements.length - 1 : currentIndex - 1)
    : (currentIndex < 0 || currentIndex >= elements.length - 1 ? 0 : currentIndex + 1);
  elements[nextIndex]?.focus();
}

function activeHtmlElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function focusElement(element: HTMLElement): void {
  if (typeof element.focus === 'function') element.focus({ preventScroll: true });
}

function scrollElementIntoView(element: HTMLElement): void {
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
}

function collectElementStates(selector: string): ElementState[] {
  return Array.from(document.querySelectorAll(selector))
    .filter((element) => isElementVisible(element))
    .slice(0, 12)
    .map((element) => elementState(element))
    .filter((state): state is ElementState => Boolean(state));
}

function elementState(element: Element | null): ElementState | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    exists: true,
    testId: element.getAttribute('data-ui-id') || '',
    tag: element.tagName.toLowerCase(),
    id: element.id || '',
    role: element.getAttribute('role') || '',
    ariaLabel: element.getAttribute('aria-label') || '',
    title: element.getAttribute('title') || '',
    placeholder: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.placeholder : '',
    text: elementText(element),
    value: elementValue(element),
    checked: element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) ? element.checked : null,
    visible: isElementVisible(element),
    disabled: isElementDisabled(element),
    focused: document.activeElement === element,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

function elementText(element: Element): string {
  return normalizeText(element.textContent || '').slice(0, 500);
}

function elementValue(element: Element): string | number | boolean | null {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') return element.checked;
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  if (element instanceof HTMLProgressElement) return element.value;
  if (element instanceof HTMLMeterElement) return element.value;
  if (element instanceof HTMLElement && element.isContentEditable) return element.textContent || '';
  return null;
}

function isElementVisible(element: Element): boolean {
  if (!element.isConnected) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isElementDisabled(element: Element): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return true;
  if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    return element.disabled || element.matches(':disabled');
  }
  const disabledFieldset = element.closest('fieldset:disabled');
  return Boolean(disabledFieldset);
}

function describeElement(element: Element): string {
  const id = element.getAttribute('data-ui-id') || element.id || element.getAttribute('aria-label') || element.tagName.toLowerCase();
  return id;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
