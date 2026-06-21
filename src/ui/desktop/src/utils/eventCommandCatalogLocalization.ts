import type { EditorProjectCatalog } from '../api/client';
import type { MvCommand } from '../composables/useEventEditor';

export type CommandCatalogKey = Exclude<keyof EditorProjectCatalog, 'project' | 'assets' | 'maps'> | 'maps' | 'tilesets';
export type CommandAssetKey = keyof EditorProjectCatalog['assets'];
export type CommandFieldPath = (number | string)[];

export interface CommandFieldVisibility {
  path: CommandFieldPath;
  equals: unknown | readonly unknown[];
}

export interface CommandField {
  label: string;
  path: CommandFieldPath;
  kind: 'text' | 'multiline' | 'number' | 'boolean' | 'select' | 'database' | 'asset';
  options?: [unknown, string][];
  catalog?: CommandCatalogKey;
  asset?: CommandAssetKey;
  min?: number;
  max?: number;
  visibleWhen?: CommandFieldVisibility | CommandFieldVisibility[];
}

export interface CommandDefinition {
  code: number;
  kind: string;
  label: string;
  page: 1 | 2 | 3;
  group: string;
  fields: CommandField[];
}

type Def = Omit<CommandDefinition, 'page' | 'group'>;

const onOff: [unknown, string][] = [[0, 'ON'], [1, 'OFF']];
const enableDisable: [unknown, string][] = [[0, '允许'], [1, '禁止']];
const increaseDecrease: [unknown, string][] = [[0, '增加'], [1, '减少']];
const constantVariable: [unknown, string][] = [[0, '常量'], [1, '变量']];
const variableOperandType: [unknown, string][] = [[0, '常量'], [1, '变量'], [2, '随机数'], [3, '游戏数据'], [4, '脚本']];
const actorTarget: [unknown, string][] = [[0, '固定角色'], [1, '队伍角色']];
const direction: [unknown, string][] = [[0, '保持'], [2, '下'], [4, '左'], [6, '右'], [8, '上']];
const vehicle: [unknown, string][] = [[0, '小船'], [1, '大船'], [2, '飞艇']];
const locationOperand: [unknown, string][] = [[0, '直接指定'], [1, '变量指定']];
const pictureOrigin: [unknown, string][] = [[0, '左上'], [1, '中心']];
const blendMode: [unknown, string][] = [[0, '普通'], [1, '加法'], [2, '乘法'], [3, '滤色']];
const comparison: [unknown, string][] = [[0, '='], [1, '≥'], [2, '≤'], [3, '>'], [4, '<'], [5, '≠']];
const gameDataOperand: [unknown, string][] = [[0, '物品持有数'], [1, '武器持有数'], [2, '防具持有数'], [3, '角色数据'], [4, '敌人数据'], [5, '角色/事件位置'], [6, '队伍成员'], [7, '其他数据']];
const buttonOptions: [unknown, string][] = [[2, '下'], [4, '左'], [6, '右'], [8, '上'], [11, 'A'], [12, 'B'], [13, 'C'], [14, 'X'], [15, 'Y'], [16, 'Z'], [17, 'L'], [18, 'R']];
const conditionTypes: [unknown, string][] = [[0, '开关'], [1, '变量'], [2, '独立开关'], [3, '计时器'], [4, '角色'], [5, '敌人'], [6, '角色/事件朝向'], [7, '金钱'], [8, '物品'], [9, '武器'], [10, '防具'], [11, '按键'], [12, '脚本'], [13, '交通工具']];
const actorConditionTypes: [unknown, string][] = [[0, '在队伍中'], [1, '名字'], [2, '职业'], [3, '技能'], [4, '武器'], [5, '防具'], [6, '状态']];
const enemyConditionTypes: [unknown, string][] = [[0, '出现'], [1, '状态']];
const timerComparison: [unknown, string][] = [[0, '以上'], [1, '以下']];
const goldComparison: [unknown, string][] = [[0, '以上'], [1, '以下'], [2, '小于']];
const audioFields = (asset: CommandAssetKey): CommandField[] => [
  { label: '文件', path: [0, 'name'], kind: 'asset', asset },
  { label: '音量', path: [0, 'volume'], kind: 'number', min: 0, max: 100 },
  { label: '音调', path: [0, 'pitch'], kind: 'number', min: 50, max: 150 },
  { label: '声像', path: [0, 'pan'], kind: 'number', min: -100, max: 100 },
];
const when = (path: CommandFieldPath, equals: unknown | readonly unknown[]): CommandFieldVisibility => ({ path, equals });
const basicOperandFields = (offset = 0): CommandField[] => [
  { label: '操作', path: [offset], kind: 'select', options: increaseDecrease },
  { label: '值类型', path: [offset + 1], kind: 'select', options: constantVariable },
  { label: '常量', path: [offset + 2], kind: 'number', visibleWhen: when([offset + 1], 0) },
  { label: '变量', path: [offset + 2], kind: 'database', catalog: 'variables', visibleWhen: when([offset + 1], 1) },
];
const controlVariableOperandFields = (): CommandField[] => [
  { label: '操作数类型', path: [3], kind: 'select', options: variableOperandType },
  { label: '常量', path: [4], kind: 'number', visibleWhen: when([3], 0) },
  { label: '变量', path: [4], kind: 'database', catalog: 'variables', visibleWhen: when([3], 1) },
  { label: '随机最小值', path: [4], kind: 'number', visibleWhen: when([3], 2) },
  { label: '随机最大值', path: [5], kind: 'number', visibleWhen: when([3], 2) },
  { label: '游戏数据', path: [4], kind: 'select', options: gameDataOperand, visibleWhen: when([3], 3) },
  { label: '数据参数 1', path: [5], kind: 'number', visibleWhen: when([3], 3) },
  { label: '数据参数 2', path: [6], kind: 'number', visibleWhen: when([3], 3) },
  { label: '脚本', path: [4], kind: 'multiline', visibleWhen: when([3], 4) },
];
const actorFields = (): CommandField[] => [
  { label: '目标类型', path: [0], kind: 'select', options: actorTarget },
  { label: '角色', path: [1], kind: 'database', catalog: 'actors', visibleWhen: when([0], 0) },
  { label: '队伍位置', path: [1], kind: 'number', min: 1, visibleWhen: when([0], 1) },
];

const PAGE_1: { group: string; items: Def[] }[] = [
  { group: '消息', items: [
    { code: 101, kind: 'text', label: '显示文字', fields: [] },
    { code: 102, kind: 'choice', label: '显示选项', fields: [] },
    { code: 103, kind: 'inputNumber', label: '数值输入处理', fields: [{ label: '变量', path: [0], kind: 'database', catalog: 'variables' }, { label: '位数', path: [1], kind: 'number', min: 1, max: 8 }] },
    { code: 104, kind: 'selectItem', label: '物品选择处理', fields: [{ label: '变量', path: [0], kind: 'database', catalog: 'variables' }, { label: '物品类型', path: [1], kind: 'select', options: [[1, '普通物品'], [2, '关键物品'], [3, '隐藏物品 A'], [4, '隐藏物品 B']] }] },
    { code: 105, kind: 'scrollText', label: '显示滚动文字', fields: [] },
  ] },
  { group: '游戏进程', items: [
    { code: 121, kind: 'switch', label: '开关操作', fields: [{ label: '起始开关', path: [0], kind: 'database', catalog: 'switches' }, { label: '结束开关', path: [1], kind: 'database', catalog: 'switches' }, { label: '值', path: [2], kind: 'select', options: onOff }] },
    { code: 122, kind: 'variable', label: '变量操作', fields: [{ label: '起始变量', path: [0], kind: 'database', catalog: 'variables' }, { label: '结束变量', path: [1], kind: 'database', catalog: 'variables' }, { label: '操作', path: [2], kind: 'select', options: [[0, '代入'], [1, '加算'], [2, '减算'], [3, '乘算'], [4, '除算'], [5, '取余']] }, ...controlVariableOperandFields()] },
    { code: 123, kind: 'selfSwitch', label: '独立开关操作', fields: [{ label: '独立开关', path: [0], kind: 'select', options: [['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D']] }, { label: '值', path: [1], kind: 'select', options: onOff }] },
    { code: 124, kind: 'timer', label: '计时器操作', fields: [{ label: '操作', path: [0], kind: 'select', options: [[0, '开始'], [1, '停止']] }, { label: '秒数', path: [1], kind: 'number', min: 0 }] },
  ] },
  { group: '流程控制', items: [
    { code: 111, kind: 'conditional', label: '分支条件', fields: conditionFields() },
    { code: 112, kind: 'loop', label: '循环', fields: [] },
    { code: 113, kind: 'breakLoop', label: '跳出循环', fields: [] },
    { code: 115, kind: 'exitEvent', label: '中止事件处理', fields: [] },
    { code: 117, kind: 'commonEvent', label: '公共事件', fields: [{ label: '公共事件', path: [0], kind: 'database', catalog: 'commonEvents' }] },
    { code: 118, kind: 'label', label: '标签', fields: [{ label: '名称', path: [0], kind: 'text' }] },
    { code: 119, kind: 'jumpLabel', label: '转到标签', fields: [{ label: '名称', path: [0], kind: 'text' }] },
    { code: 108, kind: 'comment', label: '注释', fields: [] },
  ] },
  { group: '队伍', items: [
    { code: 125, kind: 'changeGold', label: '增减金币', fields: basicOperandFields() },
    { code: 126, kind: 'changeItems', label: '增减物品', fields: [{ label: '物品', path: [0], kind: 'database', catalog: 'items' }, ...basicOperandFields(1)] },
    { code: 127, kind: 'changeWeapons', label: '增减武器', fields: [{ label: '武器', path: [0], kind: 'database', catalog: 'weapons' }, ...basicOperandFields(1), { label: '包含装备', path: [4], kind: 'boolean' }] },
    { code: 128, kind: 'changeArmors', label: '增减防具', fields: [{ label: '防具', path: [0], kind: 'database', catalog: 'armors' }, ...basicOperandFields(1), { label: '包含装备', path: [4], kind: 'boolean' }] },
    { code: 129, kind: 'changeParty', label: '队伍管理', fields: [{ label: '角色', path: [0], kind: 'database', catalog: 'actors' }, { label: '操作', path: [1], kind: 'select', options: [[0, '加入'], [1, '离开']] }, { label: '初始化', path: [2], kind: 'boolean' }] },
  ] },
  { group: '角色', items: [
    { code: 311, kind: 'changeHp', label: '增减 HP', fields: [...actorFields(), ...basicOperandFields(2), { label: '允许死亡', path: [5], kind: 'boolean' }] },
    { code: 312, kind: 'changeMp', label: '增减 MP', fields: [...actorFields(), ...basicOperandFields(2)] },
    { code: 326, kind: 'changeTp', label: '增减 TP', fields: [...actorFields(), ...basicOperandFields(2)] },
    { code: 313, kind: 'changeState', label: '更改状态', fields: [...actorFields(), { label: '操作', path: [2], kind: 'select', options: [[0, '附加'], [1, '解除']] }, { label: '状态', path: [3], kind: 'database', catalog: 'states' }] },
    { code: 314, kind: 'recoverAll', label: '完全恢复', fields: actorFields() },
    { code: 315, kind: 'changeExp', label: '增减经验值', fields: [...actorFields(), ...basicOperandFields(2), { label: '显示升级', path: [5], kind: 'boolean' }] },
    { code: 316, kind: 'changeLevel', label: '增减等级', fields: [...actorFields(), ...basicOperandFields(2), { label: '显示升级', path: [5], kind: 'boolean' }] },
    { code: 317, kind: 'changeParam', label: '增减能力值', fields: [...actorFields(), { label: '能力值', path: [2], kind: 'select', options: [[0, '最大 HP'], [1, '最大 MP'], [2, '攻击力'], [3, '防御力'], [4, '魔法力'], [5, '魔法防御'], [6, '敏捷'], [7, '幸运']] }, ...basicOperandFields(3)] },
    { code: 318, kind: 'changeSkill', label: '增减技能', fields: [...actorFields(), { label: '操作', path: [2], kind: 'select', options: [[0, '学会'], [1, '忘记']] }, { label: '技能', path: [3], kind: 'database', catalog: 'skills' }] },
    { code: 319, kind: 'changeEquip', label: '更改装备', fields: [{ label: '角色', path: [0], kind: 'database', catalog: 'actors' }, { label: '装备类型', path: [1], kind: 'database', catalog: 'equipTypes' }, { label: '装备 ID', path: [2], kind: 'number', min: 0 }] },
    { code: 320, kind: 'changeName', label: '更改名字', fields: [{ label: '角色', path: [0], kind: 'database', catalog: 'actors' }, { label: '名字', path: [1], kind: 'text' }] },
    { code: 321, kind: 'changeClass', label: '更改职业', fields: [{ label: '角色', path: [0], kind: 'database', catalog: 'actors' }, { label: '职业', path: [1], kind: 'database', catalog: 'classes' }, { label: '保留等级', path: [2], kind: 'boolean' }] },
    { code: 324, kind: 'changeNickname', label: '更改昵称', fields: [{ label: '角色', path: [0], kind: 'database', catalog: 'actors' }, { label: '昵称', path: [1], kind: 'text' }] },
    { code: 325, kind: 'changeProfile', label: '更改简介', fields: [{ label: '角色', path: [0], kind: 'database', catalog: 'actors' }, { label: '简介', path: [1], kind: 'multiline' }] },
  ] },
];

const PAGE_2: { group: string; items: Def[] }[] = [
  { group: '移动', items: [
    { code: 201, kind: 'transfer', label: '场所移动', fields: transferPlayerFields() },
    { code: 202, kind: 'vehicleLocation', label: '设置交通工具位置', fields: vehicleLocationFields() },
    { code: 203, kind: 'eventLocation', label: '设置事件位置', fields: eventLocationFields() },
    { code: 204, kind: 'scrollMap', label: '滚动地图', fields: [{ label: '方向', path: [0], kind: 'select', options: direction.filter(([value]) => value !== 0) }, { label: '距离', path: [1], kind: 'number', min: 1 }, { label: '速度', path: [2], kind: 'number', min: 1, max: 6 }, { label: '等待结束', path: [3], kind: 'boolean' }] },
    { code: 205, kind: 'moveRoute', label: '设置移动路线', fields: [] },
    { code: 206, kind: 'vehicle', label: '上下交通工具', fields: [] },
  ] },
  { group: '人物', items: [
    { code: 211, kind: 'transparency', label: '更改透明状态', fields: [{ label: '透明', path: [0], kind: 'select', options: onOff }] },
    { code: 216, kind: 'followers', label: '更改队列行进', fields: [{ label: '队列行进', path: [0], kind: 'select', options: onOff }] },
    { code: 217, kind: 'gatherFollowers', label: '集合队列成员', fields: [] },
    { code: 212, kind: 'animation', label: '显示动画', fields: [{ label: '目标 ID', path: [0], kind: 'number', min: -1 }, { label: '动画', path: [1], kind: 'database', catalog: 'animations' }, { label: '等待结束', path: [2], kind: 'boolean' }] },
    { code: 213, kind: 'balloon', label: '显示气泡图标', fields: [{ label: '目标 ID', path: [0], kind: 'number', min: -1 }, { label: '气泡', path: [1], kind: 'select', options: [[1, '惊叹'], [2, '问号'], [3, '音符'], [4, '爱心'], [5, '愤怒'], [6, '汗'], [7, '纠结'], [8, '沉默'], [9, '灯泡'], [10, 'Zzz']] }, { label: '等待结束', path: [2], kind: 'boolean' }] },
    { code: 214, kind: 'eraseEvent', label: '暂时消除事件', fields: [] },
  ] },
  { group: '图片', items: [
    { code: 231, kind: 'showPicture', label: '显示图片', fields: pictureFields(true) },
    { code: 232, kind: 'movePicture', label: '移动图片', fields: [...pictureFields(false), { label: '持续帧数', path: [10], kind: 'number', min: 0 }, { label: '等待结束', path: [11], kind: 'boolean' }] },
    { code: 233, kind: 'rotatePicture', label: '旋转图片', fields: [{ label: '图片编号', path: [0], kind: 'number', min: 1 }, { label: '速度', path: [1], kind: 'number' }] },
    { code: 234, kind: 'tintPicture', label: '更改图片色调', fields: [{ label: '图片编号', path: [0], kind: 'number', min: 1 }, ...toneFields(1), { label: '持续帧数', path: [2], kind: 'number', min: 0 }, { label: '等待结束', path: [3], kind: 'boolean' }] },
    { code: 235, kind: 'erasePicture', label: '消除图片', fields: [{ label: '图片编号', path: [0], kind: 'number', min: 1 }] },
  ] },
  { group: '等待', items: [
    { code: 230, kind: 'wait', label: '等待', fields: [{ label: '帧数', path: [0], kind: 'number', min: 1 }] },
  ] },
  { group: '画面', items: [
    { code: 221, kind: 'fadeout', label: '淡出画面', fields: [] },
    { code: 222, kind: 'fadein', label: '淡入画面', fields: [] },
    { code: 223, kind: 'tint', label: '更改画面色调', fields: [...toneFields(0), { label: '持续帧数', path: [1], kind: 'number', min: 0 }, { label: '等待结束', path: [2], kind: 'boolean' }] },
    { code: 224, kind: 'flash', label: '闪烁画面', fields: [...colorFields(0), { label: '持续帧数', path: [1], kind: 'number', min: 0 }, { label: '等待结束', path: [2], kind: 'boolean' }] },
    { code: 225, kind: 'shake', label: '震动画面', fields: [{ label: '强度', path: [0], kind: 'number', min: 1, max: 9 }, { label: '速度', path: [1], kind: 'number', min: 1, max: 9 }, { label: '持续帧数', path: [2], kind: 'number', min: 0 }, { label: '等待结束', path: [3], kind: 'boolean' }] },
    { code: 236, kind: 'weather', label: '设置天气效果', fields: [{ label: '天气', path: [0], kind: 'select', options: [['none', '无'], ['rain', '雨'], ['storm', '暴风雨'], ['snow', '雪']] }, { label: '强度', path: [1], kind: 'number', min: 0, max: 9 }, { label: '持续帧数', path: [2], kind: 'number', min: 0 }, { label: '等待结束', path: [3], kind: 'boolean' }] },
  ] },
  { group: '音频和视频', items: [
    { code: 241, kind: 'playBgm', label: '播放 BGM', fields: audioFields('bgm') },
    { code: 242, kind: 'fadeoutBgm', label: '淡出 BGM', fields: [{ label: '秒数', path: [0], kind: 'number', min: 0 }] },
    { code: 243, kind: 'saveBgm', label: '保存 BGM', fields: [] },
    { code: 244, kind: 'replayBgm', label: '恢复 BGM', fields: [] },
    { code: 245, kind: 'playBgs', label: '播放 BGS', fields: audioFields('bgs') },
    { code: 246, kind: 'fadeoutBgs', label: '淡出 BGS', fields: [{ label: '秒数', path: [0], kind: 'number', min: 0 }] },
    { code: 249, kind: 'playMe', label: '播放 ME', fields: audioFields('me') },
    { code: 250, kind: 'playSe', label: '播放 SE', fields: audioFields('se') },
    { code: 251, kind: 'stopSe', label: '停止 SE', fields: [] },
    { code: 261, kind: 'movie', label: '播放影片', fields: [{ label: '影片', path: [0], kind: 'asset', asset: 'movies' }] },
  ] },
];

const PAGE_3: { group: string; items: Def[] }[] = [
  { group: '场景控制', items: [
    { code: 301, kind: 'battle', label: '战斗处理', fields: battleProcessingFields() },
    { code: 302, kind: 'shop', label: '商店处理', fields: shopGoodsFields(true) },
    { code: 303, kind: 'nameInput', label: '名称输入处理', fields: [{ label: '角色', path: [0], kind: 'database', catalog: 'actors' }, { label: '最大字数', path: [1], kind: 'number', min: 1, max: 16 }] },
    { code: 351, kind: 'menu', label: '打开菜单画面', fields: [] },
    { code: 352, kind: 'save', label: '打开存档画面', fields: [] },
    { code: 353, kind: 'gameOver', label: '游戏结束', fields: [] },
    { code: 354, kind: 'title', label: '返回标题画面', fields: [] },
  ] },
  { group: '系统设置', items: [
    { code: 132, kind: 'battleBgm', label: '更改战斗 BGM', fields: audioFields('bgm') },
    { code: 133, kind: 'victoryMe', label: '更改胜利 ME', fields: audioFields('me') },
    { code: 139, kind: 'defeatMe', label: '更改战败 ME', fields: audioFields('me') },
    { code: 140, kind: 'vehicleBgm', label: '更改交通工具 BGM', fields: [{ label: '交通工具', path: [0], kind: 'select', options: vehicle }, ...audioFields('bgm').map((field) => ({ ...field, path: [1, ...field.path.slice(1)] }))] },
    { code: 134, kind: 'saveAccess', label: '更改存档访问', fields: [{ label: '存档', path: [0], kind: 'select', options: enableDisable }] },
    { code: 135, kind: 'menuAccess', label: '更改菜单访问', fields: [{ label: '菜单', path: [0], kind: 'select', options: enableDisable }] },
    { code: 136, kind: 'encounter', label: '更改遇敌状态', fields: [{ label: '遇敌', path: [0], kind: 'select', options: enableDisable }] },
    { code: 137, kind: 'formation', label: '更改队形访问', fields: [{ label: '队形', path: [0], kind: 'select', options: enableDisable }] },
    { code: 138, kind: 'windowColor', label: '更改窗口颜色', fields: colorFields(0) },
    { code: 322, kind: 'actorImages', label: '更改角色图像', fields: [{ label: '角色', path: [0], kind: 'database', catalog: 'actors' }, { label: '角色图', path: [1], kind: 'asset', asset: 'characters' }, { label: '角色图索引', path: [2], kind: 'number', min: 0, max: 7 }, { label: '脸图', path: [3], kind: 'asset', asset: 'faces' }, { label: '脸图索引', path: [4], kind: 'number', min: 0, max: 7 }, { label: '战斗图', path: [5], kind: 'asset', asset: 'svActors' }] },
    { code: 323, kind: 'vehicleImage', label: '更改交通工具图像', fields: [{ label: '交通工具', path: [0], kind: 'select', options: vehicle }, { label: '角色图', path: [1], kind: 'asset', asset: 'characters' }, { label: '索引', path: [2], kind: 'number', min: 0, max: 7 }] },
  ] },
  { group: '地图', items: [
    { code: 281, kind: 'mapName', label: '更改地图名称显示', fields: [{ label: '地图名称', path: [0], kind: 'select', options: [[0, '显示'], [1, '隐藏']] }] },
    { code: 282, kind: 'tileset', label: '更改图块组', fields: [{ label: '图块组', path: [0], kind: 'database', catalog: 'tilesets' }] },
    { code: 283, kind: 'battleback', label: '更改战斗背景', fields: [{ label: '背景 1', path: [0], kind: 'asset', asset: 'battlebacks1' }, { label: '背景 2', path: [1], kind: 'asset', asset: 'battlebacks2' }] },
    { code: 284, kind: 'parallax', label: '更改远景', fields: [{ label: '远景', path: [0], kind: 'asset', asset: 'parallaxes' }, { label: '横向循环', path: [1], kind: 'boolean' }, { label: '纵向循环', path: [2], kind: 'boolean' }, { label: '横向滚动', path: [3], kind: 'number' }, { label: '纵向滚动', path: [4], kind: 'number' }] },
    { code: 285, kind: 'locationInfo', label: '获取位置信息', fields: locationInfoFields() },
  ] },
  { group: '战斗', items: [
    { code: 331, kind: 'enemyHp', label: '增减敌人 HP', fields: enemyOperandFields(true) },
    { code: 332, kind: 'enemyMp', label: '增减敌人 MP', fields: enemyOperandFields(false) },
    { code: 342, kind: 'enemyTp', label: '增减敌人 TP', fields: enemyOperandFields(false) },
    { code: 333, kind: 'enemyState', label: '更改敌人状态', fields: [{ label: '敌人序号', path: [0], kind: 'number', min: -1 }, { label: '操作', path: [1], kind: 'select', options: [[0, '附加'], [1, '解除']] }, { label: '状态', path: [2], kind: 'database', catalog: 'states' }] },
    { code: 334, kind: 'enemyRecover', label: '敌人完全恢复', fields: [{ label: '敌人序号', path: [0], kind: 'number', min: -1 }] },
    { code: 335, kind: 'enemyAppear', label: '敌人出现', fields: [{ label: '敌人序号', path: [0], kind: 'number', min: 0 }] },
    { code: 336, kind: 'enemyTransform', label: '敌人变身', fields: [{ label: '敌人序号', path: [0], kind: 'number', min: 0 }, { label: '敌人', path: [1], kind: 'database', catalog: 'enemies' }] },
    { code: 337, kind: 'battleAnimation', label: '显示战斗动画', fields: [{ label: '敌人序号', path: [0], kind: 'number', min: -1 }, { label: '动画', path: [1], kind: 'database', catalog: 'animations' }, { label: '镜像', path: [2], kind: 'boolean' }] },
    { code: 339, kind: 'forceAction', label: '强制行动', fields: [{ label: '主体类型', path: [0], kind: 'select', options: [[0, '敌人'], [1, '角色']] }, { label: '主体编号', path: [1], kind: 'number' }, { label: '技能', path: [2], kind: 'database', catalog: 'skills' }, { label: '目标序号', path: [3], kind: 'number' }] },
    { code: 340, kind: 'abortBattle', label: '中止战斗', fields: [] },
  ] },
  { group: '高级', items: [
    { code: 355, kind: 'script', label: '脚本', fields: [] },
    { code: 356, kind: 'plugin', label: '插件命令', fields: [{ label: '命令', path: [0], kind: 'multiline' }] },
  ] },
];

function conditionFields(): CommandField[] {
  return [
    { label: '条件类型', path: [0], kind: 'select', options: conditionTypes },
    { label: '开关', path: [1], kind: 'database', catalog: 'switches', visibleWhen: when([0], 0) },
    { label: '开关值', path: [2], kind: 'select', options: onOff, visibleWhen: when([0], 0) },
    { label: '变量', path: [1], kind: 'database', catalog: 'variables', visibleWhen: when([0], 1) },
    { label: '比较对象', path: [2], kind: 'select', options: constantVariable, visibleWhen: when([0], 1) },
    { label: '常量', path: [3], kind: 'number', visibleWhen: [when([0], 1), when([2], 0)] },
    { label: '比较变量', path: [3], kind: 'database', catalog: 'variables', visibleWhen: [when([0], 1), when([2], 1)] },
    { label: '比较', path: [4], kind: 'select', options: comparison, visibleWhen: when([0], 1) },
    { label: '独立开关', path: [1], kind: 'select', options: [['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D']], visibleWhen: when([0], 2) },
    { label: '独立开关值', path: [2], kind: 'select', options: onOff, visibleWhen: when([0], 2) },
    { label: '秒数', path: [1], kind: 'number', min: 0, visibleWhen: when([0], 3) },
    { label: '计时器比较', path: [2], kind: 'select', options: timerComparison, visibleWhen: when([0], 3) },
    { label: '角色', path: [1], kind: 'database', catalog: 'actors', visibleWhen: when([0], 4) },
    { label: '角色条件', path: [2], kind: 'select', options: actorConditionTypes, visibleWhen: when([0], 4) },
    { label: '名字', path: [3], kind: 'text', visibleWhen: [when([0], 4), when([2], 1)] },
    { label: '职业', path: [3], kind: 'database', catalog: 'classes', visibleWhen: [when([0], 4), when([2], 2)] },
    { label: '技能', path: [3], kind: 'database', catalog: 'skills', visibleWhen: [when([0], 4), when([2], 3)] },
    { label: '武器', path: [3], kind: 'database', catalog: 'weapons', visibleWhen: [when([0], 4), when([2], 4)] },
    { label: '防具', path: [3], kind: 'database', catalog: 'armors', visibleWhen: [when([0], 4), when([2], 5)] },
    { label: '状态', path: [3], kind: 'database', catalog: 'states', visibleWhen: [when([0], 4), when([2], 6)] },
    { label: '敌人序号', path: [1], kind: 'number', min: 0, visibleWhen: when([0], 5) },
    { label: '敌人条件', path: [2], kind: 'select', options: enemyConditionTypes, visibleWhen: when([0], 5) },
    { label: '敌人状态', path: [3], kind: 'database', catalog: 'states', visibleWhen: [when([0], 5), when([2], 1)] },
    { label: '目标 ID', path: [1], kind: 'number', min: -1, visibleWhen: when([0], 6) },
    { label: '朝向', path: [2], kind: 'select', options: direction.filter(([value]) => value !== 0), visibleWhen: when([0], 6) },
    { label: '金钱', path: [1], kind: 'number', min: 0, visibleWhen: when([0], 7) },
    { label: '金钱比较', path: [2], kind: 'select', options: goldComparison, visibleWhen: when([0], 7) },
    { label: '物品', path: [1], kind: 'database', catalog: 'items', visibleWhen: when([0], 8) },
    { label: '武器', path: [1], kind: 'database', catalog: 'weapons', visibleWhen: when([0], 9) },
    { label: '包含装备', path: [2], kind: 'boolean', visibleWhen: when([0], 9) },
    { label: '防具', path: [1], kind: 'database', catalog: 'armors', visibleWhen: when([0], 10) },
    { label: '包含装备', path: [2], kind: 'boolean', visibleWhen: when([0], 10) },
    { label: '按键', path: [1], kind: 'select', options: buttonOptions, visibleWhen: when([0], 11) },
    { label: '脚本', path: [1], kind: 'multiline', visibleWhen: when([0], 12) },
    { label: '交通工具', path: [1], kind: 'select', options: vehicle, visibleWhen: when([0], 13) },
  ];
}

function transferPlayerFields(): CommandField[] {
  return [
    { label: '位置指定', path: [0], kind: 'select', options: locationOperand },
    { label: '地图', path: [1], kind: 'database', catalog: 'maps', visibleWhen: when([0], 0) },
    { label: 'X', path: [2], kind: 'number', min: 0, visibleWhen: when([0], 0) },
    { label: 'Y', path: [3], kind: 'number', min: 0, visibleWhen: when([0], 0) },
    { label: '地图变量', path: [1], kind: 'database', catalog: 'variables', visibleWhen: when([0], 1) },
    { label: 'X 变量', path: [2], kind: 'database', catalog: 'variables', visibleWhen: when([0], 1) },
    { label: 'Y 变量', path: [3], kind: 'database', catalog: 'variables', visibleWhen: when([0], 1) },
    { label: '朝向', path: [4], kind: 'select', options: direction },
    { label: '淡入淡出', path: [5], kind: 'select', options: [[0, '黑'], [1, '白'], [2, '无']] },
  ];
}

function vehicleLocationFields(): CommandField[] {
  return [
    { label: '交通工具', path: [0], kind: 'select', options: vehicle },
    { label: '位置指定', path: [1], kind: 'select', options: locationOperand },
    { label: '地图', path: [2], kind: 'database', catalog: 'maps', visibleWhen: when([1], 0) },
    { label: 'X', path: [3], kind: 'number', min: 0, visibleWhen: when([1], 0) },
    { label: 'Y', path: [4], kind: 'number', min: 0, visibleWhen: when([1], 0) },
    { label: '地图变量', path: [2], kind: 'database', catalog: 'variables', visibleWhen: when([1], 1) },
    { label: 'X 变量', path: [3], kind: 'database', catalog: 'variables', visibleWhen: when([1], 1) },
    { label: 'Y 变量', path: [4], kind: 'database', catalog: 'variables', visibleWhen: when([1], 1) },
  ];
}

function eventLocationFields(): CommandField[] {
  return [
    { label: '目标 ID', path: [0], kind: 'number', min: -1 },
    { label: '位置指定', path: [1], kind: 'select', options: [[0, '直接指定'], [1, '变量指定'], [2, '与角色/事件交换']] },
    { label: 'X', path: [2], kind: 'number', min: 0, visibleWhen: when([1], 0) },
    { label: 'Y', path: [3], kind: 'number', min: 0, visibleWhen: when([1], 0) },
    { label: 'X 变量', path: [2], kind: 'database', catalog: 'variables', visibleWhen: when([1], 1) },
    { label: 'Y 变量', path: [3], kind: 'database', catalog: 'variables', visibleWhen: when([1], 1) },
    { label: '交换目标 ID', path: [2], kind: 'number', min: -1, visibleWhen: when([1], 2) },
    { label: '朝向', path: [4], kind: 'select', options: direction },
  ];
}

function locationInfoFields(): CommandField[] {
  return [
    { label: '写入变量', path: [0], kind: 'database', catalog: 'variables' },
    { label: '信息类型', path: [1], kind: 'select', options: [[0, '地形标记'], [1, '事件编号'], [2, '图块编号（层 1）'], [3, '图块编号（层 2）'], [4, '图块编号（层 3）'], [5, '区域编号']] },
    { label: '位置指定', path: [2], kind: 'select', options: locationOperand },
    { label: 'X', path: [3], kind: 'number', min: 0, visibleWhen: when([2], 0) },
    { label: 'Y', path: [4], kind: 'number', min: 0, visibleWhen: when([2], 0) },
    { label: 'X 变量', path: [3], kind: 'database', catalog: 'variables', visibleWhen: when([2], 1) },
    { label: 'Y 变量', path: [4], kind: 'database', catalog: 'variables', visibleWhen: when([2], 1) },
  ];
}

function battleProcessingFields(): CommandField[] {
  return [
    { label: '敌群指定', path: [0], kind: 'select', options: [[0, '直接指定'], [1, '变量指定'], [2, '与地图遇敌相同']] },
    { label: '敌群', path: [1], kind: 'database', catalog: 'troops', visibleWhen: when([0], 0) },
    { label: '敌群变量', path: [1], kind: 'database', catalog: 'variables', visibleWhen: when([0], 1) },
    { label: '允许逃跑', path: [2], kind: 'boolean' },
    { label: '允许失败', path: [3], kind: 'boolean' },
  ];
}

function shopGoodsFields(includePurchaseOnly: boolean): CommandField[] {
  return [
    { label: '商品类型', path: [0], kind: 'select', options: [[0, '物品'], [1, '武器'], [2, '防具']] },
    { label: '物品', path: [1], kind: 'database', catalog: 'items', visibleWhen: when([0], 0) },
    { label: '武器', path: [1], kind: 'database', catalog: 'weapons', visibleWhen: when([0], 1) },
    { label: '防具', path: [1], kind: 'database', catalog: 'armors', visibleWhen: when([0], 2) },
    { label: '价格类型', path: [2], kind: 'select', options: [[0, '数据库价格'], [1, '指定价格']] },
    { label: '价格', path: [3], kind: 'number', min: 0, visibleWhen: when([2], 1) },
    ...(includePurchaseOnly ? [{ label: '仅购买', path: [4], kind: 'boolean' } as CommandField] : []),
  ];
}

function pictureFields(includeName: boolean): CommandField[] {
  return [
    { label: '图片编号', path: [0], kind: 'number', min: 1 },
    ...(includeName ? [{ label: '图片', path: [1], kind: 'asset', asset: 'pictures' } as CommandField] : []),
    { label: '原点', path: [2], kind: 'select', options: pictureOrigin },
    { label: '位置指定', path: [3], kind: 'select', options: locationOperand },
    { label: 'X', path: [4], kind: 'number', visibleWhen: when([3], 0) },
    { label: 'Y', path: [5], kind: 'number', visibleWhen: when([3], 0) },
    { label: 'X 变量', path: [4], kind: 'database', catalog: 'variables', visibleWhen: when([3], 1) },
    { label: 'Y 变量', path: [5], kind: 'database', catalog: 'variables', visibleWhen: when([3], 1) },
    { label: '横向缩放', path: [6], kind: 'number' },
    { label: '纵向缩放', path: [7], kind: 'number' },
    { label: '不透明度', path: [8], kind: 'number', min: 0, max: 255 },
    { label: '合成方式', path: [9], kind: 'select', options: blendMode },
  ];
}
function toneFields(index: number): CommandField[] {
  return [['红', 0], ['绿', 1], ['蓝', 2], ['灰度', 3]].map(([label, child]) => ({ label: String(label), path: [index, Number(child)], kind: 'number' }));
}
function colorFields(index: number): CommandField[] {
  return [['红', 0], ['绿', 1], ['蓝', 2], ['强度', 3]].map(([label, child]) => ({ label: String(label), path: [index, Number(child)], kind: 'number' }));
}
function enemyOperandFields(allowDeath: boolean): CommandField[] {
  return [{ label: '敌人序号', path: [0], kind: 'number', min: -1 }, ...basicOperandFields(1), ...(allowDeath ? [{ label: '允许死亡', path: [4], kind: 'boolean' } as CommandField] : [])];
}

export const COMMAND_PAGES = [PAGE_1, PAGE_2, PAGE_3].map((groups, pageIndex) => groups.map((group) => ({
  ...group,
  items: group.items.map((item) => ({ ...item, page: (pageIndex + 1) as 1 | 2 | 3, group: group.group })),
})));

export const COMMAND_DEFINITIONS: CommandDefinition[] = COMMAND_PAGES.flatMap((groups) => groups.flatMap((group) => group.items));
export const STANDARD_COMMAND_CODES = COMMAND_DEFINITIONS.map((item) => item.code);
const definitionByCode = new Map(COMMAND_DEFINITIONS.map((definition) => [definition.code, definition]));
const definitionByKind = new Map(COMMAND_DEFINITIONS.map((definition) => [definition.kind, definition]));

export function commandDefinition(code: number): CommandDefinition | undefined {
  return definitionByCode.get(code);
}
export function commandLabel(code: number): string {
  return commandDefinition(code)?.label || `Raw command ${code}`;
}
export function commandTemplate(kind: string, mapId = 1): MvCommand[] {
  const code = definitionByKind.get(kind)?.code ?? 0;
  const p = (...parameters: unknown[]): MvCommand => ({ code, indent: 0, parameters });
  const templates: Record<number, MvCommand[]> = {
    101: [p('', 0, 0, 2), { code: 401, indent: 0, parameters: [''] }],
    102: [p(['Yes', 'No'], 0, 1, 2, 0), { code: 402, indent: 0, parameters: [0, 'Yes'] }, { code: 402, indent: 0, parameters: [1, 'No'] }, { code: 404, indent: 0, parameters: [] }],
    105: [p(2, false), { code: 405, indent: 0, parameters: [''] }],
    108: [p('')],
    111: [p(0, 1, 0), { code: 412, indent: 0, parameters: [] }],
    112: [p(), { code: 413, indent: 0, parameters: [] }],
    205: [p(0, defaultMoveRoute())],
    355: [p(''), { code: 655, indent: 0, parameters: [''] }],
  };
  const defaults: Record<number, unknown[]> = {
    103: [1, 1], 104: [1, 2], 115: [], 117: [1], 118: [''], 119: [''],
    121: [1, 1, 0], 122: [1, 1, 0, 0, 0], 123: ['A', 0], 124: [0, 60],
    125: [0, 0, 50], 126: [1, 0, 0, 1], 127: [1, 0, 0, 1, false], 128: [1, 0, 0, 1, false], 129: [1, 0, false],
    311: [0, 1, 0, 0, 0, false], 312: [0, 1, 0, 0, 0], 326: [0, 1, 0, 0, 0], 313: [0, 1, 0, 1], 314: [0, 1],
    315: [0, 1, 0, 0, 0, false], 316: [0, 1, 0, 0, 0, false], 317: [0, 1, 0, 0, 0, 0], 318: [0, 1, 0, 1],
    319: [1, 0, 0], 320: [1, ''], 321: [1, 1, false], 324: [1, ''], 325: [1, ''],
    201: [0, mapId, 0, 0, 2, 0], 202: [0, 0, mapId, 0, 0], 203: [0, 0, 0, 0, 0], 204: [2, 1, 4, false], 206: [],
    211: [0], 216: [0], 217: [], 212: [0, 1, true], 213: [0, 1, true], 214: [],
    230: [60], 231: [1, '', 0, 0, 0, 0, 100, 100, 255, 0], 232: [1, 0, 0, 0, 0, 0, 100, 100, 255, 0, 60, true],
    233: [1, 0], 234: [1, [0, 0, 0, 0], 60, true], 235: [1], 221: [], 222: [], 223: [[0, 0, 0, 0], 60, true],
    224: [[255, 255, 255, 170], 30, true], 225: [5, 5, 30, true], 236: ['none', 5, 60, true],
    241: [defaultAudio()], 242: [10], 243: [], 244: [], 245: [defaultAudio()], 246: [10], 249: [defaultAudio()], 250: [defaultAudio()], 251: [], 261: [''],
    301: [0, 1, true, false], 302: [0, 1, 0, 0, false], 303: [1, 8], 351: [], 352: [], 353: [], 354: [],
    132: [defaultAudio()], 133: [defaultAudio()], 139: [defaultAudio()], 140: [0, defaultAudio()], 134: [0], 135: [0], 136: [0], 137: [0],
    138: [[0, 0, 0, 0]], 322: [1, '', 0, '', 0, ''], 323: [0, '', 0], 281: [0], 282: [1], 283: ['', ''], 284: ['', false, false, 0, 0], 285: [1, 0, 0, 0, 0],
    331: [-1, 0, 0, 0, false], 332: [-1, 0, 0, 0], 342: [-1, 0, 0, 0], 333: [-1, 0, 1], 334: [-1], 335: [0],
    336: [0, 1], 337: [-1, 1, false], 339: [0, 0, 1, -1], 340: [], 356: [''],
  };
  return cloneCommands(templates[code] || [{ code, indent: 0, parameters: defaults[code] || [] }]);
}
export function defaultCommandParams(code: number): unknown[] {
  return cloneCommands(commandTemplate(commandDefinition(code)?.kind || 'raw'))[0]?.parameters || [];
}
export function normalizeEventCommandParameters(command: MvCommand): MvCommand {
  const p = command.parameters;
  if (command.code === 111) {
    normalizeConditionalBranchParameters(p);
  } else if (command.code === 122) {
    normalizeControlVariablesParameters(p);
  } else if ([125, 126, 127, 128, 311, 312, 315, 316, 317, 326, 331, 332, 342].includes(command.code)) {
    normalizeBasicOperandParameters(p, command.code === 125 ? 0 : [126, 127, 128, 331, 332, 342].includes(command.code) ? 1 : command.code === 317 ? 3 : 2);
  } else if ([201, 231, 232, 285, 301, 302].includes(command.code)) {
    ensureNumberAt(p, 0, 0);
  } else if ([202, 203].includes(command.code)) {
    ensureNumberAt(p, 1, 0);
  }
  return command;
}
export function applyCommandIndent(commands: MvCommand[], indent: number): MvCommand[] {
  const min = commands.reduce((value, command) => Math.min(value, command.indent), Number.POSITIVE_INFINITY);
  const base = Number.isFinite(min) ? min : 0;
  return cloneCommands(commands).map((command) => ({ ...command, indent: Math.max(0, command.indent - base + indent) }));
}
function defaultMoveRoute() {
  return { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false };
}
function defaultAudio() {
  return { name: '', volume: 90, pitch: 100, pan: 0 };
}
function normalizeConditionalBranchParameters(params: unknown[]) {
  const type = ensureNumberAt(params, 0, 0);
  if (type === 2) {
    ensureStringAt(params, 1, 'A');
    ensureNumberAt(params, 2, 0);
  } else if (type === 3 || type === 7) {
    ensureNumberAt(params, 1, 0);
    ensureNumberAt(params, 2, 0);
  } else if (type === 4 || type === 5) {
    ensureNumberAt(params, 1, 1);
    const subtype = ensureNumberAt(params, 2, 0);
    if (type === 4 && subtype === 1) ensureStringAt(params, 3, '');
    else if ((type === 4 && subtype >= 2) || (type === 5 && subtype === 1)) ensureNumberAt(params, 3, 1);
  } else if (type === 6) {
    ensureNumberAt(params, 1, 0);
    ensureNumberAt(params, 2, 2);
  } else if ([8, 9, 10, 11, 13].includes(type)) {
    ensureNumberAt(params, 1, type === 11 ? 2 : 1);
    if (type === 9 || type === 10) ensureBooleanAt(params, 2, false);
  } else if (type === 12) {
    ensureStringAt(params, 1, '');
  } else {
    ensureNumberAt(params, 1, 1);
    ensureNumberAt(params, 2, 0);
    if (type === 1) {
      ensureNumberAt(params, 3, 0);
      ensureNumberAt(params, 4, 0);
    }
  }
}
function normalizeControlVariablesParameters(params: unknown[]) {
  ensureNumberAt(params, 0, 1);
  ensureNumberAt(params, 1, Number(params[0]) || 1);
  ensureNumberAt(params, 2, 0);
  const operandType = ensureNumberAt(params, 3, 0);
  if (operandType === 2) {
    ensureNumberAt(params, 4, 0);
    ensureNumberAt(params, 5, Number(params[4]) || 0);
  } else if (operandType === 3) {
    ensureNumberAt(params, 4, 0);
    ensureNumberAt(params, 5, 0);
    ensureNumberAt(params, 6, 0);
  } else if (operandType === 4) {
    ensureStringAt(params, 4, '');
  } else {
    ensureNumberAt(params, 4, 0);
  }
}
function normalizeBasicOperandParameters(params: unknown[], offset: number) {
  ensureNumberAt(params, offset, 0);
  const operandType = ensureNumberAt(params, offset + 1, 0);
  if (operandType === 1) ensureNumberAt(params, offset + 2, 1);
  else ensureNumberAt(params, offset + 2, 0);
}
function ensureNumberAt(params: unknown[], index: number, fallback: number): number {
  const current = params[index];
  const value = Number.isFinite(Number(current)) && current !== '' ? Number(current) : fallback;
  params[index] = value;
  return value;
}
function ensureStringAt(params: unknown[], index: number, fallback: string): string {
  const current = params[index];
  const value = typeof current === 'string' ? current : fallback;
  params[index] = value;
  return value;
}
function ensureBooleanAt(params: unknown[], index: number, fallback: boolean): boolean {
  const current = params[index];
  const value = typeof current === 'boolean' ? current : fallback;
  params[index] = value;
  return value;
}
function cloneCommands(commands: MvCommand[]): MvCommand[] {
  return JSON.parse(JSON.stringify(commands));
}
