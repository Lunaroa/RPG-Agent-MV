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
  moveRouteOperations: readonly NumberOption[];
  moveRouteLabels: Readonly<Record<number, string>>;
  balloonIconLabels: Readonly<Record<number, string>>;
  messageBackgroundLabels: readonly string[];
  messagePositionLabels: readonly string[];
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

export const EVENT_CONDITION_EMPTY_LABEL = '无条件';
export const EVENT_IMAGE_EMPTY_LABEL = '无图像';
