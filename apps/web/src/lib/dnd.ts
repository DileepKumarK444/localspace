import type { NodeKind, TreeItem } from './tree';

export interface IndexEntry { item: TreeItem; parent: TreeItem | null; siblings: TreeItem[] }
export type DropPos = 'before' | 'inside' | 'after';
export interface DropPlan { pos: DropPos; parent: { kind: NodeKind; id: string } | null; beforeId: string | null }

export function indexTree(items: TreeItem[]): Map<string, IndexEntry> {
  const map = new Map<string, IndexEntry>();
  const walk = (list: TreeItem[], parent: TreeItem | null) => {
    for (const item of list) { map.set(item.id, { item, parent, siblings: list }); walk(item.children, item); }
  };
  walk(items, null);
  return map;
}

export function subtreeIds(item: TreeItem): Set<string> {
  const out = new Set<string>([item.id]);
  item.children.forEach((c) => subtreeIds(c).forEach((i) => out.add(i)));
  return out;
}

/**
 * Decides where a dragged item lands when dropped on `target`.
 * Folders only live in folders/root; pages can be nested in folders or pages. The top/bottom quarter of a
 * row means "before/after this sibling", the middle means "inside".
 */
export function planDrop(drag: { kind: NodeKind; id: string }, target: TreeItem, fraction: number, index: Map<string, IndexEntry>): DropPlan | null {
  const dragged = index.get(drag.id);
  const entry = index.get(target.id);
  if (!dragged || !entry) return null;
  if (subtreeIds(dragged.item).has(target.id)) return null; // onto itself or its own descendant

  if (drag.kind === 'folder' && target.kind === 'page') return null;
  const inside: DropPlan = { pos: 'inside', parent: { kind: target.kind, id: target.id }, beforeId: null };
  if (drag.kind === 'page' && target.kind === 'folder') return inside;

  // sibling placement (same kind as target)
  const parent = entry.parent ? { kind: entry.parent.kind, id: entry.parent.id } : null;
  if (fraction < 0.25) return { pos: 'before', parent, beforeId: target.id };
  if (fraction > 0.75) {
    const sameKind = entry.siblings.filter((s) => s.kind === target.kind);
    const next = sameKind.slice(sameKind.indexOf(target) + 1).find((x) => x.id !== drag.id);
    return { pos: 'after', parent, beforeId: next?.id ?? null };
  }
  return inside;
}
