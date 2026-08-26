import type { Component } from 'vue'
import type { UiDesignerNodeType } from '@contract/ui-designer'
import {
  ArrowDown,
  ArrowUp,
  Box,
  ChartNoAxesColumnIncreasing,
  ChevronsDown,
  ChevronsUp,
  ClipboardPaste,
  Copy,
  Eye,
  Film,
  Grid3X3,
  Group,
  Image,
  Layers,
  List,
  ListFilter,
  Lock,
  MousePointerClick,
  Pencil,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Type,
  Video,
} from '@lucide/vue'
import type { UiNodeActionCommand } from '../models/actions'

export const UI_DESIGNER_NODE_TYPE_ICONS: Record<UiDesignerNodeType, Component> = {
  container: Box,
  list: List,
  sprite: Image,
  nineSlice: Grid3X3,
  frameAnimation: Film,
  button: MousePointerClick,
  text: Type,
  progressBar: ChartNoAxesColumnIncreasing,
  overlay: Layers,
  video: Video,
  particle: Sparkles,
}

export const UI_DESIGNER_NODE_ACTION_ICONS: Record<UiNodeActionCommand, Component> = {
  copy: Copy,
  cut: Scissors,
  paste: ClipboardPaste,
  addChild: Plus,
  rename: Pencil,
  duplicate: Copy,
  group: Group,
  sameType: ListFilter,
  moveUp: ArrowUp,
  moveDown: ArrowDown,
  moveTop: ChevronsUp,
  moveBottom: ChevronsDown,
  toggleVisibility: Eye,
  toggleLock: Lock,
  delete: Trash2,
}

export const UI_DESIGNER_NODE_ACTION_GROUPS: readonly (readonly UiNodeActionCommand[])[] = [
  ['copy', 'cut', 'paste'],
  ['addChild', 'rename', 'duplicate', 'group', 'sameType'],
  ['moveUp', 'moveDown', 'moveTop', 'moveBottom'],
  ['toggleVisibility', 'toggleLock'],
  ['delete'],
]
