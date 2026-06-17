// 事件编辑纯函数 / 类型 / 常量。
// 移植自 legacy frontend/src/app/event-editor/ 的
// event-formatters.js、command-templates.js、event-state.js。
// 零响应式——与 useMapRenderer.ts 同红线。
import { commandLabel as catalogCommandLabel } from './eventCommandCatalog.ts';
export { COMMAND_DEFINITIONS, COMMAND_PAGES, STANDARD_COMMAND_CODES, applyCommandIndent, commandDefinition, commandLabel, commandTemplate, defaultCommandParams } from './eventCommandCatalog.ts';

// ---- 类型 ----

export interface MvCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

export interface MvMoveRoute {
  list: { code: number; parameters: unknown[] }[];
  repeat: boolean;
  skippable: boolean;
  wait: boolean;
}

export interface MvEventConditions {
  actorId: number;
  actorValid: boolean;
  itemId: number;
  itemValid: boolean;
  selfSwitchCh: string;
  selfSwitchValid: boolean;
  switch1Id: number;
  switch1Valid: boolean;
  switch2Id: number;
  switch2Valid: boolean;
  variableId: number;
  variableValid: boolean;
  variableValue: number;
}

export interface MvEventImage {
  tileId: number;
  characterName: string;
  direction: number;
  pattern: number;
  characterIndex: number;
}

export interface MvEventPage {
  conditions: MvEventConditions;
  directionFix: boolean;
  image: MvEventImage;
  list: MvCommand[];
  moveFrequency: number;
  moveRoute: MvMoveRoute;
  moveSpeed: number;
  moveType: number;
  priorityType: number;
  stepAnime: boolean;
  through: boolean;
  trigger: number;
  walkAnime: boolean;
}

export interface MvEditorEvent {
  id: number;
  name: string;
  note: string;
  x: number;
  y: number;
  pages: MvEventPage[];
}

export function findEditorMapEvent(events: unknown[] | undefined, eventId: number): MvEditorEvent | null {
  if (!Array.isArray(events) || !Number.isInteger(eventId) || eventId <= 0) return null;
  const atIndex = events[eventId];
  if (atIndex && typeof atIndex === 'object' && !Array.isArray(atIndex)) {
    const event = atIndex as MvEditorEvent;
    return { ...event, id: Number(event.id) > 0 ? Number(event.id) : eventId };
  }
  for (let index = 0; index < events.length; index += 1) {
    const item = events[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const event = item as MvEditorEvent;
    if (Number(event.id) === eventId) return { ...event, id: eventId };
  }
  return null;
}

// ---- 常量 ----

export const TRIGGERS: [string, string][] = [
  ['0', '确定键'],
  ['1', '玩家接触'],
  ['2', '事件接触'],
  ['3', '自动执行'],
  ['4', '并行处理'],
];

export const TRIGGER_LABELS: Record<number, string> = {
  0: '确定键', 1: '玩家接触', 2: '事件接触', 3: '自动执行', 4: '并行处理',
};

export const PRIORITIES: [string, string][] = [
  ['0', '人物下方'], ['1', '与人物相同'], ['2', '人物上方'],
];

export const PRIORITY_LABELS: Record<number, string> = {
  0: '人物下方', 1: '与人物相同', 2: '人物上方',
};

export const MOVE_TYPES: [string, string][] = [
  ['0', '固定'], ['1', '随机'], ['2', '接近'], ['3', '自定义'],
];

export const MOVE_SPEEDS: [string, string][] = [
  ['1', '1：极慢'], ['2', '2：很慢'], ['3', '3：较慢'],
  ['4', '4：普通'], ['5', '5：较快'], ['6', '6：很快'],
];

export const MOVE_FREQS: [string, string][] = [
  ['1', '1：最低'], ['2', '2：较低'], ['3', '3：普通'],
  ['4', '4：较高'], ['5', '5：最高'],
];

export const SELF_SWITCH_CHANNELS = ['A', 'B', 'C', 'D'] as const;

export const MOVE_ROUTE_OPERATIONS: [number, string][] = [
  [1, '向下移动'], [2, '向左移动'], [3, '向右移动'], [4, '向上移动'],
  [5, '左下移动'], [6, '右下移动'], [7, '左上移动'], [8, '右上移动'],
  [9, '随机移动'], [10, '接近玩家'], [11, '远离玩家'], [12, '前进一步'], [13, '后退一步'],
  [14, '跳跃'], [15, '等待'], [16, '面向下方'], [17, '面向左方'], [18, '面向右方'], [19, '面向上方'],
  [20, '向右转 90°'], [21, '向左转 90°'], [22, '转身 180°'], [23, '随机转向 90°'],
  [24, '随机转向'], [25, '面向玩家'], [26, '背对玩家'], [27, '打开开关'], [28, '关闭开关'],
  [29, '更改速度'], [30, '更改频率'], [31, '开启步行动画'], [32, '关闭步行动画'],
  [33, '开启踏步动画'], [34, '关闭踏步动画'], [35, '固定朝向'], [36, '解除固定朝向'],
  [37, '开启穿透'], [38, '关闭穿透'], [39, '开启透明'], [40, '关闭透明'],
  [41, '更改图像'], [42, '更改不透明度'], [43, '更改合成方式'], [44, '播放 SE'], [45, '脚本'],
];

const MOVE_ROUTE_LABELS = Object.fromEntries(MOVE_ROUTE_OPERATIONS);

// ---- 深拷贝 ----

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

// ---- 默认值工厂 ----

export function defaultConditions(): MvEventConditions {
  return {
    actorId: 1, actorValid: false, itemId: 1, itemValid: false,
    selfSwitchCh: 'A', selfSwitchValid: false,
    switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false,
    variableId: 1, variableValid: false, variableValue: 0,
  };
}

export function defaultImage(): MvEventImage {
  return { tileId: 0, characterName: '', direction: 2, pattern: 1, characterIndex: 0 };
}

export function defaultMoveRoute(): MvMoveRoute {
  return { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false };
}

export function defaultPage(): MvEventPage {
  return {
    conditions: defaultConditions(),
    directionFix: false,
    image: defaultImage(),
    list: [{ code: 0, indent: 0, parameters: [] }],
    moveFrequency: 3,
    moveRoute: defaultMoveRoute(),
    moveSpeed: 3,
    moveType: 0,
    priorityType: 1,
    stepAnime: false,
    through: false,
    trigger: 0,
    walkAnime: true,
  };
}

export function defaultEvent(id: number, x: number, y: number): MvEditorEvent {
  return {
    id,
    name: `EV${String(id).padStart(3, '0')}`,
    note: '',
    x, y,
    pages: [defaultPage()],
  };
}

// ---- 命令列表工具 ----

export function editableCommands(page: MvEventPage): MvCommand[] {
  const list = page && Array.isArray(page.list) ? page.list : [];
  return list.filter((command, index) => !(index === list.length - 1 && command.code === 0));
}

export interface MvCommandSpan {
  index: number;
  commands: MvCommand[];
}

export function editableCommandSpans(page: MvEventPage): MvCommandSpan[] {
  const list = page && Array.isArray(page.list) ? page.list : [];
  const spans: MvCommandSpan[] = [];
  for (let index = 0; index < list.length;) {
    if (index === list.length - 1 && list[index].code === 0) break;
    const length = commandSpanLength(list, index);
    spans.push({ index, commands: list.slice(index, index + length) });
    index += length;
  }
  return spans;
}

export function commandSpanLength(list: MvCommand[], index: number): number {
  const head = list[index]?.code;
  const follower = head === 101 ? 401
    : head === 105 ? 405
      : head === 108 ? 408
        : head === 205 ? 505
          : head === 302 ? 605
            : head === 355 ? 655
              : null;
  if (follower == null) return 1;
  let length = 1;
  while (list[index + length]?.code === follower) length += 1;
  return length;
}

export function ensureTerminator(list: MvCommand[]): void {
  while (list.length && list[list.length - 1].code === 0) list.pop();
  list.push({ code: 0, indent: 0, parameters: [] });
}

const STRUCTURE_END: Record<number, number> = { 102: 404, 111: 412, 112: 413, 301: 604 };
const STRUCTURE_OPEN = new Set(Object.keys(STRUCTURE_END).map(Number));
const STRUCTURE_CLOSE = new Set(Object.values(STRUCTURE_END));
const STRUCTURE_BRANCH = new Set([402, 403, 411, 601, 602, 603]);
const STRUCTURE_MARKER_START: Record<number, number> = {
  402: 102,
  403: 102,
  404: 102,
  411: 111,
  412: 111,
  413: 112,
  601: 301,
  602: 301,
  603: 301,
  604: 301,
};

function structureStartForMarker(spans: MvCommandSpan[], selectedIndex: number, startCode: number): number {
  const marker = spans[selectedIndex]?.commands[0];
  if (!marker) return -1;

  for (let index = selectedIndex - 1; index >= 0; index -= 1) {
    const head = spans[index]?.commands[0];
    if (!head || head.indent !== marker.indent) continue;
    if (head.code === startCode) return index;
    if (head.code === STRUCTURE_END[startCode]) break;
  }

  return -1;
}

export function commandBlockSpanIndices(spans: MvCommandSpan[], selected: number[]): number[] {
  const expanded = new Set(selected);
  for (const selectedIndex of [...expanded]) {
    const code = spans[selectedIndex]?.commands[0]?.code;
    const markerStartCode = STRUCTURE_MARKER_START[code];
    if (markerStartCode === undefined) continue;
    const markerStartIndex = structureStartForMarker(spans, selectedIndex, markerStartCode);
    if (markerStartIndex >= 0) expanded.add(markerStartIndex);
  }

  for (const selectedIndex of [...expanded]) {
    const endCode = STRUCTURE_END[spans[selectedIndex]?.commands[0]?.code];
    if (!endCode) continue;
    let depth = 0;
    for (let index = selectedIndex + 1; index < spans.length; index += 1) {
      const code = spans[index].commands[0]?.code;
      expanded.add(index);
      if (code === spans[selectedIndex].commands[0].code) depth += 1;
      else if (code === endCode) {
        if (!depth) break;
        depth -= 1;
      }
    }
  }
  return [...expanded].sort((a, b) => a - b);
}

export function commandInsertIndent(list: MvCommand[], rawIndex: number): number {
  let indent = 0;
  for (let index = 0; index < rawIndex; index += 1) {
    const code = list[index]?.code;
    if (STRUCTURE_CLOSE.has(code)) indent = Math.max(0, indent - 1);
    if (STRUCTURE_BRANCH.has(code)) indent = Math.max(0, indent - 1);
    if (STRUCTURE_OPEN.has(code)) indent += 1;
    if (STRUCTURE_BRANCH.has(code)) indent += 1;
  }
  return indent;
}

// ---- 命令显示（移植 event-formatters.js commandDisplay） ----

export interface CommandDisplayResult {
  label: string;
  tone: string;
  indent: number;
}

interface SystemData {
  switches?: string[];
  variables?: string[];
}

function clampInt(value: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function namedSystemEntry(system: SystemData | null, kind: 'switches' | 'variables', id: unknown): string {
  const num = Number(id || 0);
  if (!num) return '0000';
  const list = system && Array.isArray(system[kind]) ? system[kind] : [];
  const name = list[num] || '';
  return `${String(num).padStart(4, '0')}${name ? ` ${name}` : ''}`;
}

function namedSystemRange(system: SystemData | null, kind: 'switches' | 'variables', start: unknown, end: unknown): string {
  const first = Number(start || 0);
  const last = Number(end || start || 0);
  if (!first) return '0000';
  if (first === last) return namedSystemEntry(system, kind, first);
  return `${namedSystemEntry(system, kind, first)}..${namedSystemEntry(system, kind, last)}`;
}

function conditionBranchDisplay(system: SystemData | null, params: unknown[]): string {
  const type = Number(params[0] || 0);
  if (type === 0) return `${namedSystemEntry(system, 'switches', params[1])} 为 ${params[2] === 1 ? 'OFF' : 'ON'}`;
  if (type === 1) {
    const ops = ['=', '≥', '≤', '>', '<', '!='];
    const op = ops[Number(params[4] || 0)] || String(params[4]);
    return `${namedSystemEntry(system, 'variables', params[1])} ${op} ${params[2] === 1 ? namedSystemEntry(system, 'variables', params[3]) : params[3]}`;
  }
  if (type === 2) return `独立开关 ${params[1]} 为 ${params[2] === 1 ? 'OFF' : 'ON'}`;
  return `条件类型 ${type}: ${JSON.stringify(params)}`;
}

function eventTargetLabel(value: unknown): string {
  const target = Number(value);
  if (target === -1) return '玩家';
  if (target === 0) return '本事件';
  if (Number.isFinite(target) && target > 0) return `EV${String(target).padStart(3, '0')}`;
  return String(value || 0);
}

function balloonIconLabel(value: unknown): string {
  const labels: Record<number, string> = {
    1: '惊叹', 2: '问号', 3: '音符', 4: '爱心', 5: '愤怒',
    6: '汗', 7: '纠结', 8: '沉默', 9: '灯泡', 10: 'Zzz',
  };
  return labels[Number(value)] || `图标${value || 0}`;
}

function messageFaceLabel(params: unknown[]): string {
  const face = String(params[0] || '');
  return face ? `${face}(${params[1] || 0})` : '无';
}

function messageBackgroundLabel(value: unknown): string {
  return ['窗口', '暗淡', '透明'][Number(value) || 0] || `背景${value}`;
}

function messagePositionLabel(value: unknown): string {
  const pos = Number.isFinite(Number(value)) ? Number(value) : 2;
  return ['顶部', '中部', '底部'][pos] || `位置${value}`;
}

export function commandDisplay(command: MvCommand, system?: SystemData | null): CommandDisplayResult {
  const p = command.parameters || [];
  const indent = clampInt(command.indent, 0, 12);
  const line = (label: string, tone = 'normal'): CommandDisplayResult => ({ label: `◆${label}`, tone, indent });

  if (command.code === 101) return line(`文本：${messageFaceLabel(p)}, ${messageBackgroundLabel(p[2])}, ${messagePositionLabel(p[3])}`, 'text');
  if (command.code === 401) return { label: `：${p[0] || ''}`, tone: 'text', indent: Math.min(indent + 1, 12) };
  if (command.code === 102) return line(`显示选择项：${(p[0] as string[] || []).join(' / ')}`, 'control');
  if (command.code === 402) return line(`选择 ${p[1] || p[0] || ''} 时`, 'text');
  if (command.code === 403) return line('取消时', 'text');
  if (command.code === 404) return line('选择结束', 'control');
  if (command.code === 108 || command.code === 408) return line(`注释：${p[0] || ''}`, 'normal');
  if (command.code === 111) return line(`如果：${conditionBranchDisplay(system || null, p)}`, 'text');
  if (command.code === 112) return line('循环', 'control');
  if (command.code === 113) return line('中断循环', 'control');
  if (command.code === 121) return line(`开关操作：${namedSystemRange(system || null, 'switches', p[0], p[1])} = ${p[2] === 1 ? 'OFF' : 'ON'}`, 'control');
  if (command.code === 122) return line(`变量操作：${namedSystemRange(system || null, 'variables', p[0], p[1])}`, 'control');
  if (command.code === 123) return line(`独立开关操作：${p[0]} = ${p[1] === 1 ? 'OFF' : 'ON'}`, 'control');
  if (command.code === 201) return line(`场所移动：Map${p[1]} (${p[2]},${p[3]})`, 'control');
  if (command.code === 205) return line('设置移动路线', 'control');
  if (command.code === 212) return line(`显示动画：${eventTargetLabel(p[0])}, ${p[1] || 0}`, 'control');
  if (command.code === 213) return line(`显示气泡图标：${eventTargetLabel(p[0])}, ${balloonIconLabel(p[1])}`, 'control');
  if (command.code === 221) return line('淡出画面', 'control');
  if (command.code === 222) return line('淡入画面', 'control');
  if (command.code === 223) return line(`更改画面色调：${JSON.stringify(p[0] || [])}`, 'control');
  if (command.code === 224) return line(`闪烁画面：${JSON.stringify(p[0] || [])}`, 'control');
  if (command.code === 225) return line(`震动画面：强度 ${p[0] || 0}`, 'control');
  if (command.code === 230) return line(`等待：${p[0] || 0}帧`, 'control');
  if (command.code === 250) return line(`播放 SE：${(p[0] as { name?: string })?.name || ''}`, 'control');
  if (command.code === 125) return line(`增减金币：${p[0] === 1 ? '-' : '+'}${p[2] || 0}`, 'control');
  if (command.code === 314) return line('完全恢复', 'control');
  if (command.code === 117) return line(`公共事件：${p[0] || 0}`, 'control');
  if (command.code === 356) return line(`插件命令：${p[0] || ''}`, 'control');
  if (command.code === 411) return line('除此以外', 'control');
  if (command.code === 412) return line('分歧结束', 'control');
  if (command.code === 413) return line('重复以上内容', 'control');
  if (command.code === 505) return { label: `：${moveRouteCommandLabel(p[0])}`, tone: 'control', indent: Math.min(indent + 1, 12) };
  if (command.code === 405 || command.code === 408 || command.code === 605 || command.code === 655) return { label: `：${p[0] || ''}`, tone: 'text', indent: Math.min(indent + 1, 12) };
  const standardLabel = catalogCommandLabel(command.code);
  if (!standardLabel.startsWith('Raw command ')) return line(`${standardLabel}${p.length ? `：${JSON.stringify(p)}` : ''}`, 'control');
  return line(`Raw command ${command.code}: ${JSON.stringify(p)}`, 'raw');
}

// 命令语义配色分类（仅用于执行内容列表的命令头着色，按命令 code 归类）。
// 刻意与 commandDisplay 的 tone 解耦：commandDisplay 的 tone 被预览组件依赖，
// 此处细分只服务事件编辑器，互不影响。
const TONE_TEXT = new Set([101, 401, 102, 402, 403, 404, 405]);
const TONE_FLOW = new Set([111, 112, 113, 115, 117, 119, 411, 412, 413]);
const TONE_DATA = new Set([121, 122, 123, 124, 125, 126, 127, 128, 129, 133, 311, 312, 313, 314, 315, 316, 317]);
const TONE_MOVE = new Set([201, 202, 203, 204, 205, 206, 505]);
const TONE_RAW = new Set([355, 356, 357, 655]);
const TONE_STAGE = new Set([
  211, 212, 213, 214, 216, 217, 221, 222, 223, 224, 225,
  230, 231, 232, 233, 234, 235, 236, 241, 242, 243, 244, 245, 246, 249, 250, 251, 261, 285,
]);

export function commandTone(code: number): string {
  if (TONE_TEXT.has(code)) return 'text';
  if (TONE_FLOW.has(code)) return 'flow';
  if (TONE_DATA.has(code)) return 'data';
  if (TONE_MOVE.has(code)) return 'move';
  if (TONE_STAGE.has(code)) return 'stage';
  if (TONE_RAW.has(code)) return 'raw';
  return 'normal';
}

export function moveRouteCommandLabel(command: unknown): string {
  if (!command || typeof command !== 'object') return '无效路线步骤';
  const item = command as { code?: number; parameters?: unknown[] };
  return `${MOVE_ROUTE_LABELS[Number(item.code)] || `Raw ${item.code || 0}`}${item.parameters?.length ? `：${JSON.stringify(item.parameters)}` : ''}`;
}

// ---- 快速创建事件模板 ----

export type QuickEventType = 'transfer' | 'door' | 'treasure' | 'inn';

export function quickEventTemplate(type: QuickEventType, x: number, y: number): MvEditorEvent {
  const ev = defaultEvent(0, x, y);
  ev.name = '';

  if (type === 'transfer') {
    // 传送事件：Player Touch 触发，Transfer Player 命令
    const page = ev.pages[0];
    page.trigger = 1; // Player Touch
    page.priorityType = 1;
    page.list = [
      { code: 201, indent: 0, parameters: [0, 1, 0, 0, 2, 0] }, // Transfer Player
      { code: 0, indent: 0, parameters: [] },
    ];
    ev.name = '传送';
  } else if (type === 'door') {
    // 门事件：Player Touch 触发，带门角色图 + Transfer Player
    const page = ev.pages[0];
    page.trigger = 1; // Player Touch
    page.priorityType = 1;
    page.image = { tileId: 0, characterName: '!Door1', direction: 2, pattern: 0, characterIndex: 0 };
    page.list = [
      { code: 250, indent: 0, parameters: [{ name: 'Open1', volume: 90, pitch: 100, pan: 0 }] }, // Play SE
      { code: 205, indent: 0, parameters: [-1, { list: [{ code: 44, parameters: [{ name: 'Open1', volume: 90, pitch: 100, pan: 0 }] }, { code: 0, parameters: [] }], repeat: false, skippable: false, wait: true }] }, // Set Move Route (open door anim)
      { code: 230, indent: 0, parameters: [10] }, // Wait
      { code: 201, indent: 0, parameters: [0, 1, 0, 0, 2, 0] }, // Transfer Player
      { code: 0, indent: 0, parameters: [] },
    ];
    ev.name = '门';
  } else if (type === 'treasure') {
    // 宝箱事件：双页，第一页 ActionButton + 获得物品，第二页 Self Switch A + 打开图
    const page1 = ev.pages[0];
    page1.trigger = 0; // Action Button
    page1.priorityType = 1;
    page1.image = { tileId: 0, characterName: '!Chest', direction: 2, pattern: 1, characterIndex: 0 };
    page1.list = [
      { code: 250, indent: 0, parameters: [{ name: 'Chest1', volume: 90, pitch: 100, pan: 0 }] }, // SE
      { code: 205, indent: 0, parameters: [-1, { list: [{ code: 44, parameters: [{ name: 'Chest1', volume: 90, pitch: 100, pan: 0 }] }, { code: 0, parameters: [] }], repeat: false, skippable: false, wait: true }] }, // Open anim
      { code: 101, indent: 0, parameters: ['', 0, 0, 2] }, // Text header
      { code: 401, indent: 0, parameters: ['获得了 \\I[1] 物品！'] }, // Text body
      { code: 123, indent: 0, parameters: ['A', 0] }, // Self Switch A = ON
      { code: 0, indent: 0, parameters: [] },
    ];

    const page2 = defaultPage();
    page2.conditions.selfSwitchValid = true;
    page2.conditions.selfSwitchCh = 'A';
    page2.image = { tileId: 0, characterName: '!Chest', direction: 2, pattern: 0, characterIndex: 0 };
    page2.priorityType = 1;
    page2.trigger = 0;
    ev.pages.push(page2);
    ev.name = '宝箱';
  } else if (type === 'inn') {
    // 旅馆事件：ActionButton 触发，显示选择项 + 全回复
    const page = ev.pages[0];
    page.trigger = 0; // Action Button
    page.priorityType = 1;
    page.list = [
      { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
      { code: 401, indent: 0, parameters: ['欢迎光临旅馆。\\n需要休息吗？（50G）'] },
      { code: 102, indent: 0, parameters: [['是', '否'], 1] }, // Show Choices
      { code: 402, indent: 0, parameters: [0, '是'] }, // When "是"
      { code: 125, indent: 1, parameters: [1, 0, 50] }, // Change Gold -50
      { code: 314, indent: 1, parameters: [0] }, // Recover All
      { code: 250, indent: 1, parameters: [{ name: 'Recovery', volume: 90, pitch: 100, pan: 0 }] },
      { code: 101, indent: 1, parameters: ['', 0, 0, 2] },
      { code: 401, indent: 1, parameters: ['祝你旅途愉快！'] },
      { code: 0, indent: 1, parameters: [] },
      { code: 402, indent: 0, parameters: [1, '否'] }, // When "否"
      { code: 0, indent: 1, parameters: [] },
      { code: 404, indent: 0, parameters: [] }, // End Choices
      { code: 0, indent: 0, parameters: [] },
    ];
    ev.name = '旅馆';
  }

  return ev;
}

// ---- 条件摘要 ----

export function conditionSummary(conditions: MvEventConditions): string {
  const parts: string[] = [];
  if (conditions.switch1Valid) parts.push(`SW ${conditions.switch1Id} ON`);
  if (conditions.switch2Valid) parts.push(`SW ${conditions.switch2Id} ON`);
  if (conditions.variableValid) parts.push(`Var ${conditions.variableId} ≥ ${conditions.variableValue}`);
  if (conditions.selfSwitchValid) parts.push(`Self ${conditions.selfSwitchCh} ON`);
  if (conditions.actorValid) parts.push(`Actor ${conditions.actorId}`);
  if (conditions.itemValid) parts.push(`Item ${conditions.itemId}`);
  return parts.length ? parts.join('；') : '无条件';
}

// ---- 图像摘要 ----

export function imageSummary(image: MvEventImage): string {
  if (image.tileId) return `Tile #${image.tileId}`;
  if (image.characterName) return `${image.characterName} idx${image.characterIndex || 0}`;
  return '无图像';
}
