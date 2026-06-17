import type { MapTreeNode, RmmvAudioSettings } from '../../api/client';

export type EditorMode = 'map' | 'event';
export type MapTool = 'pencil' | 'rect' | 'ellipse' | 'fill' | 'eraser';
export type MapPaintMode = 'tile' | 'shadow' | 'region';
export type TileTab = 'A' | 'B' | 'C' | 'D' | 'E';
export type EditorStatusKind = '' | 'busy' | 'saved' | 'error';

export interface TreeNode extends MapTreeNode {
  children?: TreeNode[];
}

export interface PaletteTab {
  tab: TileTab;
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
  encounterListText: string;
  note: string;
}
