import type { ProductLanguage } from '@contract/types';
import { pickByLocale } from '../i18n/messages.ts';

export type StringOption = readonly [string, string];
export type NumberOption = readonly [number, string];

export interface EventEditorLocaleText {
  triggers: readonly StringOption[];
  triggerLabels: Readonly<Record<number, string>>;
  priorities: readonly StringOption[];
  priorityLabels: Readonly<Record<number, string>>;
  moveTypes: readonly StringOption[];
  moveSpeeds: readonly StringOption[];
  moveFrequencies: readonly StringOption[];
  blendModes: readonly NumberOption[];
  pictureOrigins: readonly string[];
  pictureEasings: readonly string[];
  moveRouteOperations: readonly NumberOption[];
  moveRouteLabels: Readonly<Record<number, string>>;
  balloonIconLabels: Readonly<Record<number, string>>;
  messageBackgroundLabels: readonly string[];
  messagePositionLabels: readonly string[];
  /** Show Choices uses left/middle/right positions, unlike the message window. */
  choicePositionLabels: readonly string[];
  /** ON/OFF value labels for Change Transparency / Followers / Map Name Display etc. */
  onOffLabels: readonly string[];
  /** Enable/Disable value labels for *Access commands. */
  enableDisableLabels: readonly string[];
  /** Increase/Decrease operation labels for items/gold/actor-stat commands. */
  operationLabels: readonly string[];
  /** Add/Remove operation labels for party membership. */
  partyMemberOperationLabels: readonly string[];
  /** Add/Remove operation labels for states. */
  stateOperationLabels: readonly string[];
  /** Learn/Forget operation labels for skills. */
  skillOperationLabels: readonly string[];
  /** Operand type labels for "Change X" commands (constant/variable/extra). */
  operandTypeLabels: readonly string[];
  /** Actor target labels: fixed actor, party member, and the actor-id 0 all-members case. */
  actorTargetLabels: readonly string[];
  /** Parameter id labels for Change Parameter (317): MaxHP/MaxMP/Attack/... */
  actorParameterLabels: readonly string[];
  /** Weather effect type labels for Set Weather Effect (236). */
  weatherTypes: readonly string[];
  /** Vehicle type labels: Boat/Ship/Airship. */
  vehicleTypes: readonly string[];
  /** Scroll direction labels for Scroll Map (204). */
  scrollDirections: readonly string[];
  /** Location type labels for Set Event Location / Get Location Info. */
  locationTypeLabels: readonly string[];
  /** Get Location Info info-type labels (285). */
  locationInfoTypeLabels: readonly string[];
  /** Goods type labels for Shop Processing (302): Items/Weapons/Armors. */
  shopGoodsTypeLabels: readonly string[];
  /** Battle troop source labels for Battle Processing (301). */
  troopSourceLabels: readonly string[];
  /** Force Action battler type labels (339). */
  forceActionBattlerLabels: readonly string[];
  /** Select Item item-type labels (104). */
  selectItemTypeLabels: readonly string[];
  /** Timer operation labels (124): Start / Stop. */
  timerOperationLabels: readonly string[];
  /** Equipment slot type labels for Change Equipment (319): Weapon/Shield/Head/Body/Accessory. */
  equipSlotLabels: readonly string[];
  /** Conditional Branch (111) gold comparison labels (type 7): or above / or below / less than. */
  goldComparisonLabels: readonly string[];
  /** Conditional Branch (111) facing-direction labels (type 6), indexed by RM direction 2/4/6/8. */
  conditionDirectionLabels: Readonly<Record<number, string>>;
  /** Conditional Branch (111) vehicle type labels (type 13): Boat/Ship/Airship. */
  conditionVehicleLabels: readonly string[];
  /** Control Variables (122) operation labels, indexed by operation id: Set/Add/Sub/Mul/Div/Mod. */
  controlVariableOperationLabels: readonly string[];
  /** Control Variables (122) game-data operand labels (operand type 3), indexed by game-data id. */
  controlVariableGameDataLabels: readonly string[];
}

export const EVENT_EDITOR_TEXT_BY_LOCALE = {
  'zh-CN': {
    triggers: [
      ['0', '确定键'],
      ['1', '玩家接触'],
      ['2', '事件接触'],
      ['3', '自动执行'],
      ['4', '并行处理'],
    ],
    triggerLabels: {
      0: '确定键',
      1: '玩家接触',
      2: '事件接触',
      3: '自动执行',
      4: '并行处理',
    },
    priorities: [
      ['0', '人物下方'],
      ['1', '与人物相同'],
      ['2', '人物上方'],
    ],
    priorityLabels: {
      0: '人物下方',
      1: '与人物相同',
      2: '人物上方',
    },
    moveTypes: [
      ['0', '固定'],
      ['1', '随机'],
      ['2', '接近'],
      ['3', '自定义'],
    ],
    moveSpeeds: [
      ['1', '1：极慢'],
      ['2', '2：很慢'],
      ['3', '3：较慢'],
      ['4', '4：普通'],
      ['5', '5：较快'],
      ['6', '6：很快'],
    ],
    moveFrequencies: [
      ['1', '1：最低'],
      ['2', '2：较低'],
      ['3', '3：普通'],
      ['4', '4：较高'],
      ['5', '5：最高'],
    ],
    blendModes: [
      [0, '普通'],
      [1, '加算'],
      [2, '正片叠底'],
      [3, '滤色'],
    ],
    pictureOrigins: ['左上', '中心'],
    pictureEasings: ['匀速', '慢速开始', '慢速结束', '慢速开始和结束'],
    moveRouteOperations: [
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
    ],
    moveRouteLabels: {
      1: '向下移动', 2: '向左移动', 3: '向右移动', 4: '向上移动',
      5: '左下移动', 6: '右下移动', 7: '左上移动', 8: '右上移动',
      9: '随机移动', 10: '接近玩家', 11: '远离玩家', 12: '前进一步', 13: '后退一步',
      14: '跳跃', 15: '等待', 16: '面向下方', 17: '面向左方', 18: '面向右方', 19: '面向上方',
      20: '向右转 90°', 21: '向左转 90°', 22: '转身 180°', 23: '随机转向 90°',
      24: '随机转向', 25: '面向玩家', 26: '背对玩家', 27: '打开开关', 28: '关闭开关',
      29: '更改速度', 30: '更改频率', 31: '开启步行动画', 32: '关闭步行动画',
      33: '开启踏步动画', 34: '关闭踏步动画', 35: '固定朝向', 36: '解除固定朝向',
      37: '开启穿透', 38: '关闭穿透', 39: '开启透明', 40: '关闭透明',
      41: '更改图像', 42: '更改不透明度', 43: '更改合成方式', 44: '播放 SE', 45: '脚本',
    },
    balloonIconLabels: {
      1: '惊叹',
      2: '问号',
      3: '音符',
      4: '爱心',
      5: '愤怒',
      6: '汗',
      7: '纠结',
      8: '沉默',
      9: '灯泡',
      10: 'Zzz',
    },
    messageBackgroundLabels: ['窗口', '暗淡', '透明'],
    messagePositionLabels: ['顶部', '中部', '底部'],
    choicePositionLabels: ['左侧', '中间', '右侧'],
    onOffLabels: ['开', '关'],
    enableDisableLabels: ['禁用', '启用'],
    operationLabels: ['增加', '减少'],
    partyMemberOperationLabels: ['加入', '离开'],
    stateOperationLabels: ['附加', '解除'],
    skillOperationLabels: ['学会', '忘记'],
    operandTypeLabels: ['常量', '变量', '游戏内道具', '游戏内角色', '游戏内敌人'],
    actorTargetLabels: ['指定角色', '队伍成员', '全体成员'],
    actorParameterLabels: ['最大HP', '最大MP', '攻击力', '防御力', '魔法攻击', '魔法防御', '敏捷', '幸运'],
    weatherTypes: ['无', '雨', '暴风雨', '雪'],
    vehicleTypes: ['小船', '大船', '飞艇'],
    scrollDirections: ['向下', '向左', '向右', '向上'],
    locationTypeLabels: ['直接指定', '变量指定', '交换'],
    locationInfoTypeLabels: ['地形标签', '事件 ID', '图块 ID（层 1）', '图块 ID（层 2）', '图块 ID（层 3）', '区域 ID'],
    shopGoodsTypeLabels: ['物品', '武器', '防具'],
    troopSourceLabels: ['直接指定', '变量指定', '随机遭遇'],
    forceActionBattlerLabels: ['敌人', '角色'],
    selectItemTypeLabels: ['未知', '普通物品', '重要物品', '隐藏物品 A', '隐藏物品 B'],
    timerOperationLabels: ['开始', '停止'],
    equipSlotLabels: ['武器', '盾牌', '头部', '身体', '装饰品'],
    goldComparisonLabels: ['以上', '以下', '低于'],
    conditionDirectionLabels: { 2: '下', 4: '左', 6: '右', 8: '上' },
    conditionVehicleLabels: ['小船', '大船', '飞艇'],
    controlVariableOperationLabels: ['代入', '加算', '减算', '乘算', '除算', '取余'],
    controlVariableGameDataLabels: ['物品持有数', '武器持有数', '防具持有数', '角色数据', '敌人数据', '角色/事件位置', '队伍成员', '其他数据'],
  },
  'en-US': {
    triggers: [
      ['0', 'Action Button'],
      ['1', 'Player Touch'],
      ['2', 'Event Touch'],
      ['3', 'Autorun'],
      ['4', 'Parallel'],
    ],
    triggerLabels: {
      0: 'Action Button',
      1: 'Player Touch',
      2: 'Event Touch',
      3: 'Autorun',
      4: 'Parallel',
    },
    priorities: [
      ['0', 'Below characters'],
      ['1', 'Same as characters'],
      ['2', 'Above characters'],
    ],
    priorityLabels: {
      0: 'Below characters',
      1: 'Same as characters',
      2: 'Above characters',
    },
    moveTypes: [
      ['0', 'Fixed'],
      ['1', 'Random'],
      ['2', 'Approach'],
      ['3', 'Custom'],
    ],
    moveSpeeds: [
      ['1', '1: Slowest'],
      ['2', '2: Slower'],
      ['3', '3: Slow'],
      ['4', '4: Normal'],
      ['5', '5: Fast'],
      ['6', '6: Fastest'],
    ],
    moveFrequencies: [
      ['1', '1: Lowest'],
      ['2', '2: Low'],
      ['3', '3: Normal'],
      ['4', '4: High'],
      ['5', '5: Highest'],
    ],
    blendModes: [
      [0, 'Normal'],
      [1, 'Additive'],
      [2, 'Multiply'],
      [3, 'Screen'],
    ],
    pictureOrigins: ['Upper Left', 'Center'],
    pictureEasings: ['Linear', 'Ease In', 'Ease Out', 'Ease In Out'],
    moveRouteOperations: [
      [1, 'Move Down'], [2, 'Move Left'], [3, 'Move Right'], [4, 'Move Up'],
      [5, 'Move Lower Left'], [6, 'Move Lower Right'], [7, 'Move Upper Left'], [8, 'Move Upper Right'],
      [9, 'Move at Random'], [10, 'Move Toward Player'], [11, 'Move Away from Player'], [12, '1 Step Forward'], [13, '1 Step Backward'],
      [14, 'Jump'], [15, 'Wait'], [16, 'Turn Down'], [17, 'Turn Left'], [18, 'Turn Right'], [19, 'Turn Up'],
      [20, 'Turn 90 Right'], [21, 'Turn 90 Left'], [22, 'Turn 180'], [23, 'Turn 90 Random'],
      [24, 'Turn Random'], [25, 'Turn Toward Player'], [26, 'Turn Away from Player'], [27, 'Switch ON'], [28, 'Switch OFF'],
      [29, 'Change Speed'], [30, 'Change Frequency'], [31, 'Walking Animation ON'], [32, 'Walking Animation OFF'],
      [33, 'Stepping Animation ON'], [34, 'Stepping Animation OFF'], [35, 'Direction Fix ON'], [36, 'Direction Fix OFF'],
      [37, 'Through ON'], [38, 'Through OFF'], [39, 'Transparent ON'], [40, 'Transparent OFF'],
      [41, 'Change Image'], [42, 'Change Opacity'], [43, 'Change Blend Mode'], [44, 'Play SE'], [45, 'Script'],
    ],
    moveRouteLabels: {
      1: 'Move Down', 2: 'Move Left', 3: 'Move Right', 4: 'Move Up',
      5: 'Move Lower Left', 6: 'Move Lower Right', 7: 'Move Upper Left', 8: 'Move Upper Right',
      9: 'Move at Random', 10: 'Move toward Player', 11: 'Move away from Player', 12: 'Move 1 Step Forward', 13: 'Move 1 Step Backward',
      14: 'Jump', 15: 'Wait', 16: 'Turn Down', 17: 'Turn Left', 18: 'Turn Right', 19: 'Turn Up',
      20: 'Turn 90 Right', 21: 'Turn 90 Left', 22: 'Turn 180', 23: 'Turn 90 Right or Left',
      24: 'Turn at Random', 25: 'Turn toward Player', 26: 'Turn away from Player', 27: 'Switch ON', 28: 'Switch OFF',
      29: 'Change Speed', 30: 'Change Frequency', 31: 'Walking Animation ON', 32: 'Walking Animation OFF',
      33: 'Stepping Animation ON', 34: 'Stepping Animation OFF', 35: 'Direction Fix ON', 36: 'Direction Fix OFF',
      37: 'Through ON', 38: 'Through OFF', 39: 'Transparent ON', 40: 'Transparent OFF',
      41: 'Change Image', 42: 'Change Opacity', 43: 'Change Blend Mode', 44: 'Play SE', 45: 'Script',
    },
    balloonIconLabels: {
      1: 'Exclamation',
      2: 'Question',
      3: 'Music Note',
      4: 'Heart',
      5: 'Anger',
      6: 'Sweat',
      7: 'Frustration',
      8: 'Silence',
      9: 'Light Bulb',
      10: 'Zzz',
    },
    messageBackgroundLabels: ['Window', 'Dim', 'Transparent'],
    messagePositionLabels: ['Top', 'Middle', 'Bottom'],
    choicePositionLabels: ['Left', 'Middle', 'Right'],
    onOffLabels: ['ON', 'OFF'],
    enableDisableLabels: ['Disable', 'Enable'],
    operationLabels: ['Increase', 'Decrease'],
    partyMemberOperationLabels: ['Add', 'Remove'],
    stateOperationLabels: ['Add', 'Remove'],
    skillOperationLabels: ['Learn', 'Forget'],
    operandTypeLabels: ['Constant', 'Variable', 'Item', 'Actor', 'Enemy'],
    actorTargetLabels: ['Actor', 'Party Member', 'Entire Party'],
    actorParameterLabels: ['MaxHP', 'MaxMP', 'Attack', 'Defense', 'M.Attack', 'M.Defense', 'Agility', 'Luck'],
    weatherTypes: ['None', 'Rain', 'Storm', 'Snow'],
    vehicleTypes: ['Boat', 'Ship', 'Airship'],
    scrollDirections: ['Down', 'Left', 'Right', 'Up'],
    locationTypeLabels: ['Direct', 'Variable', 'Exchange'],
    locationInfoTypeLabels: ['Terrain Tag', 'Event ID', 'Tile ID (Layer 1)', 'Tile ID (Layer 2)', 'Tile ID (Layer 3)', 'Region ID'],
    shopGoodsTypeLabels: ['Items', 'Weapons', 'Armors'],
    troopSourceLabels: ['Direct', 'Variable', 'Random Encounter'],
    forceActionBattlerLabels: ['Enemy', 'Actor'],
    selectItemTypeLabels: ['Unknown', 'Regular Item', 'Key Item', 'Hidden Item A', 'Hidden Item B'],
    timerOperationLabels: ['Start', 'Stop'],
    equipSlotLabels: ['Weapon', 'Shield', 'Head', 'Body', 'Accessory'],
    goldComparisonLabels: ['or Above', 'or Below', 'Less than'],
    conditionDirectionLabels: { 2: 'Down', 4: 'Left', 6: 'Right', 8: 'Up' },
    conditionVehicleLabels: ['Boat', 'Ship', 'Airship'],
    controlVariableOperationLabels: ['Set', 'Add', 'Sub', 'Mul', 'Div', 'Mod'],
    controlVariableGameDataLabels: ['Item Count', 'Weapon Count', 'Armor Count', 'Actor Data', 'Enemy Data', 'Character/Event Position', 'Party Member', 'Other Data'],
  },
} as const satisfies Record<ProductLanguage, EventEditorLocaleText>;

export function eventEditorText(language: ProductLanguage): EventEditorLocaleText {
  return pickByLocale<EventEditorLocaleText>(language, EVENT_EDITOR_TEXT_BY_LOCALE);
}

export const QUICK_EVENT_NAMES = {
  transfer: '传送',
  door: '门',
  treasure: '宝箱',
  inn: '旅馆',
} as const;

export const QUICK_EVENT_TEXT = {
  treasureItem: '获得了 \\I[1] 物品！',
  innPrompt: '欢迎光临旅馆。\\n需要休息吗？（50G）',
  innYes: '是',
  innNo: '否',
  innThanks: '祝你旅途愉快！',
} as const;
