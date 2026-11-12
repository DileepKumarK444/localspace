import type { FolderNode, PageNode } from '@localspace/shared';

export type NodeKind = 'folder' | 'page';
export interface TreeItem {
  kind: NodeKind;
  id: string;
  title: string;
  color: string | null;
  children: TreeItem[];
}

const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

/** Builds the unified display tree: folders (with subfolders then pages) and pages (with child pages). */
export function buildTree(folders: FolderNode[], pages: PageNode[]): TreeItem[] {
  const foldersByParent = new Map<string | null, FolderNode[]>();
  const pagesByFolder = new Map<string | null, PageNode[]>();
  const pagesByParent = new Map<string, PageNode[]>();
  for (const f of folders) foldersByParent.set(f.parentId, [...(foldersByParent.get(f.parentId) ?? []), f]);
  for (const p of pages) {
    if (p.parentPageId) pagesByParent.set(p.parentPageId, [...(pagesByParent.get(p.parentPageId) ?? []), p]);
    else pagesByFolder.set(p.folderId, [...(pagesByFolder.get(p.folderId) ?? []), p]);
  }
  const pageItem = (p: PageNode): TreeItem => ({
    kind: 'page', id: p.id, title: p.title, color: p.color,
    children: (pagesByParent.get(p.id) ?? []).sort(byPos).map(pageItem),
  });
  const folderItem = (f: FolderNode): TreeItem => ({
    kind: 'folder', id: f.id, title: f.name, color: f.color,
    children: [
      ...(foldersByParent.get(f.id) ?? []).sort(byPos).map(folderItem),
      ...(pagesByFolder.get(f.id) ?? []).sort(byPos).map(pageItem),
    ],
  });
  return [
    ...(foldersByParent.get(null) ?? []).sort(byPos).map(folderItem),
    ...(pagesByFolder.get(null) ?? []).sort(byPos).map(pageItem),
  ];
}

/** Ancestor chain ending with the item itself. */
export function pathTo(kind: NodeKind, id: string, folders: FolderNode[], pages: PageNode[]): { kind: NodeKind; id: string; title: string }[] {
  const fById = new Map(folders.map((f) => [f.id, f]));
  const pById = new Map(pages.map((p) => [p.id, p]));
  const out: { kind: NodeKind; id: string; title: string }[] = [];
  const guard = new Set<string>();
  const addFolder = (fid: string | null) => {
    while (fid && !guard.has(fid)) {
      guard.add(fid);
      const f = fById.get(fid);
      if (!f) break;
      out.unshift({ kind: 'folder', id: f.id, title: f.name });
      fid = f.parentId;
    }
  };
  if (kind === 'folder') {
    addFolder(id);
  } else {
    let cur = pById.get(id);
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      out.unshift({ kind: 'page', id: cur.id, title: cur.title });
      if (cur.parentPageId) cur = pById.get(cur.parentPageId);
      else {
        addFolder(cur.folderId);
        break;
      }
    }
  }
  return out;
}

export function filterTree(items: TreeItem[], q: string): TreeItem[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return items;
  const walk = (list: TreeItem[]): TreeItem[] =>
    list.flatMap((i) => {
      const kids = walk(i.children);
      return i.title.toLowerCase().includes(needle) || kids.length ? [{ ...i, children: kids }] : [];
    });
  return walk(items);
}
