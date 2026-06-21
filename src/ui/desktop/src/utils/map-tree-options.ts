import type { MapTreeNode } from '../api/client';
import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'
import { translate } from '../i18n/messages.ts'

export interface MapPickerOption {
  id: number;
  label: string;
}

/** 将扁平 MapInfos 转为带层级的父地图下拉选项（首项为根目录）。 */
export function buildMapPickerOptions(flat: readonly MapTreeNode[], language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): MapPickerOption[] {
  language = normalizeProductLanguage(language)
  type Node = MapTreeNode & { children: MapTreeNode[] };
  const nodes = new Map<number, Node>();
  for (const item of flat) nodes.set(item.id, { ...item, children: [] });
  const roots: Node[] = [];
  for (const item of nodes.values()) {
    const parent = item.parentId ? nodes.get(item.parentId) : null;
    if (parent) parent.children.push(item);
    else roots.push(item);
  }
  const options: MapPickerOption[] = [{ id: 0, label: translate('maptree.root', language) }];
  const walk = (list: Node[], depth: number) => {
    for (const node of list) {
      const indent = depth > 0 ? `${'　'.repeat(depth)}└ ` : '';
      options.push({ id: node.id, label: `${indent}MAP ${node.id} · ${node.name}` });
      if (node.children.length) walk(node.children as Node[], depth + 1);
    }
  };
  walk(roots, 0);
  return options;
}
