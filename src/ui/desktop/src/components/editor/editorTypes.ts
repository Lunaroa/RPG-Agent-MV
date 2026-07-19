import type { EventSearchHit, MapTreeNode, RmmvAudioSettings, RmmvMapEncounter } from '../../api/client';

export type EditorMode = 'map' | 'event';
export type MapTool = 'pencil' | 'rect' | 'ellipse' | 'fill' | 'eraser';
export type MapPaintMode = 'tile' | 'shadow' | 'region';
export type MapLayerSelection = 'auto' | 0 | 1 | 2 | 3;
export type TileTab = 'A' | 'B' | 'C' | 'D' | 'E';
export type PaletteTabId = TileTab | 'R';
export type EditorStatusKind = '' | 'busy' | 'saved' | 'error';

export interface TreeNode extends MapTreeNode {
  children?: TreeNode[];
}

export interface EditorEventListItem {
  id: number;
  name: string;
  note: string;
  x: number;
  y: number;
}

export type EditorEventSearchHit = EventSearchHit;

export interface PaletteTab {
  tab: PaletteTabId;
  label: string;
  available: boolean;
}

export interface MapPropertiesForm {
  name: string;
  displayName: string;
  width: number;
  height: number;
  tilesetId: number;
  parentId: number;
  scrollType: number;
  specifyBattleback: boolean;
  battleback1Name: string;
  battleback2Name: string;
  autoplayBgm: boolean;
  bgm: RmmvAudioSettings;
  autoplayBgs: boolean;
  bgs: RmmvAudioSettings;
  disableDashing: boolean;
  parallaxName: string;
  parallaxLoopX: boolean;
  parallaxLoopY: boolean;
  parallaxSx: number;
  parallaxSy: number;
  parallaxShow: boolean;
  encounterStep: number;
  encounterList: RmmvMapEncounter[];
  note: string;
}
