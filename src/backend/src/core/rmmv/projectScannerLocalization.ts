import { pickByLocale } from '../../../../contract/i18n.ts';

/** Agent-visible scanner preview labels — fixed English for every locale. */
const PROJECT_SCANNER_PREVIEW_LABELS_EN = {
  face: 'Face',
  character: 'Character',
  svActor: 'SV Actor',
  enemyBattler: 'Enemy Battler',
  animationImage: 'Animation Image',
  title1: 'Title 1',
  title2: 'Title 2',
  battleback1: 'Battleback 1',
  battleback2: 'Battleback 2',
  troopMember: 'Troop Member',
  tilesetImage: 'Tileset Image',
} as const;

export type ProjectScannerPreviewLabelKey = keyof typeof PROJECT_SCANNER_PREVIEW_LABELS_EN;

export function projectScannerPreviewLabels(): typeof PROJECT_SCANNER_PREVIEW_LABELS_EN {
  return pickByLocale(null, {
    'zh-CN': PROJECT_SCANNER_PREVIEW_LABELS_EN,
    'en-US': PROJECT_SCANNER_PREVIEW_LABELS_EN,
  });
}
