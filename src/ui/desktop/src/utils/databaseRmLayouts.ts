import type { MessageKey } from '../i18n/messages';

// Stock RM database layouts: entry-type groups mirror the reference editor's
// group boxes (main column) plus the traits/damage/effects + note side column.
// Rows list field paths rendered side by side; missing paths are skipped so
// engine-filtered (e.g. MZ-only) fields simply do not render.

export interface RmPanelLayout {
  /** i18n key for the group box title; '' lets a complex field keep its own title. */
  titleKey: MessageKey | '';
  column: 'main' | 'side';
  rows: string[][];
}

// Shared by Items and Skills: the stock invocation group box.
const INVOCATION_ROWS: string[][] = [
  ['speed', 'successRate', 'repeats', 'tpGain'],
  ['hitType', 'animationId'],
];

export const DATABASE_RM_LAYOUTS: Partial<Record<string, RmPanelLayout[]>> = {
  Items: [
    {
      titleKey: 'db.panelBasic',
      column: 'main',
      rows: [
        ['name', 'iconIndex'],
        ['description'],
        ['itypeId', 'price', 'consumable'],
        ['scope', 'occasion'],
      ],
    },
    { titleKey: 'db.panelInvocation', column: 'main', rows: INVOCATION_ROWS },
    { titleKey: '', column: 'side', rows: [['damage']] },
    { titleKey: '', column: 'side', rows: [['effects']] },
    { titleKey: '', column: 'side', rows: [['note']] },
  ],
  Skills: [
    {
      titleKey: 'db.panelBasic',
      column: 'main',
      rows: [
        ['name', 'iconIndex'],
        ['description'],
        ['stypeId', 'mpCost', 'tpCost'],
        ['scope', 'occasion'],
      ],
    },
    { titleKey: 'db.panelInvocation', column: 'main', rows: INVOCATION_ROWS },
    { titleKey: 'db.panelMessage', column: 'main', rows: [['message1'], ['message2']] },
    { titleKey: 'db.panelRequiredWeapons', column: 'main', rows: [['requiredWtypeId1', 'requiredWtypeId2']] },
    { titleKey: '', column: 'side', rows: [['damage']] },
    { titleKey: '', column: 'side', rows: [['effects']] },
    { titleKey: '', column: 'side', rows: [['note']] },
  ],
  Weapons: [
    {
      titleKey: 'db.panelBasic',
      column: 'main',
      rows: [
        ['name', 'iconIndex'],
        ['description'],
        ['wtypeId', 'price'],
        ['animationId'],
      ],
    },
    { titleKey: '', column: 'main', rows: [['params']] },
    { titleKey: '', column: 'side', rows: [['traits']] },
    { titleKey: '', column: 'side', rows: [['note']] },
  ],
  Armors: [
    {
      titleKey: 'db.panelBasic',
      column: 'main',
      rows: [
        ['name', 'iconIndex'],
        ['description'],
        ['atypeId', 'price'],
        ['etypeId'],
      ],
    },
    { titleKey: '', column: 'main', rows: [['params']] },
    { titleKey: '', column: 'side', rows: [['traits']] },
    { titleKey: '', column: 'side', rows: [['note']] },
  ],
  Enemies: [
    {
      titleKey: 'db.panelBasic',
      column: 'main',
      rows: [
        ['name'],
        ['battlerName', 'params'],
      ],
    },
    { titleKey: 'db.panelRewards', column: 'main', rows: [['exp', 'gold']] },
    { titleKey: '', column: 'main', rows: [['dropItems']] },
    { titleKey: '', column: 'main', rows: [['actions']] },
    { titleKey: '', column: 'side', rows: [['traits']] },
    { titleKey: '', column: 'side', rows: [['note']] },
  ],
  States: [
    {
      titleKey: 'db.panelBasic',
      column: 'main',
      rows: [
        ['name', 'iconIndex'],
        ['restriction', 'priority'],
        ['motion', 'overlay'],
      ],
    },
    {
      titleKey: 'db.panelRemovalConditions',
      column: 'main',
      rows: [
        ['removeAtBattleEnd', 'removeByRestriction'],
        ['autoRemovalTiming', 'minTurns', 'maxTurns'],
        ['removeByDamage', 'chanceByDamage'],
        ['removeByWalking', 'stepsToRemove'],
      ],
    },
    {
      titleKey: 'db.panelMessage',
      column: 'main',
      rows: [['message1'], ['message2'], ['message3'], ['message4']],
    },
    { titleKey: '', column: 'side', rows: [['traits']] },
    { titleKey: '', column: 'side', rows: [['note']] },
  ],
  Classes: [
    { titleKey: 'db.panelBasic', column: 'main', rows: [['name', 'expParams']] },
    { titleKey: '', column: 'main', rows: [['params']] },
    { titleKey: '', column: 'main', rows: [['learnings']] },
    { titleKey: '', column: 'side', rows: [['traits']] },
    { titleKey: '', column: 'side', rows: [['note']] },
  ],
};

/** Fields never routed to the leftover panel: the id is already shown in the detail header. */
export const RM_LAYOUT_HIDDEN_PATHS = new Set(['id']);
