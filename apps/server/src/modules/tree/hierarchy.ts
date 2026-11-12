import { prisma } from '../../db';

export interface FolderMeta { id: string; name: string; parentId: string | null; position: number; color: string | null }
export interface PageMeta { id: string; title: string; folderId: string | null; parentPageId: string | null; position: number; updatedAt: Date; color: string | null }

/** Loads lightweight metadata for all non-deleted folders/pages (small for a personal workspace). */
export async function loadMeta(workspaceId: string) {
  const [folders, pages] = await Promise.all([
    prisma.folder.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, name: true, parentId: true, position: true, color: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    }),
    prisma.page.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, title: true, folderId: true, parentPageId: true, position: true, updatedAt: true, color: true },
      orderBy: [{ position: 'asc' }, { title: 'asc' }],
    }),
  ]);
  return { folders, pages };
}

export function folderPath(folderId: string | null, folders: FolderMeta[]): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: string[] = [];
  let cur = folderId ? byId.get(folderId) : undefined;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** Ancestor titles of a page (folders first, then parent pages), excluding the page itself. */
export function pagePath(pageId: string, folders: FolderMeta[], pages: PageMeta[]): string[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const chain: string[] = [];
  let cur = byId.get(pageId);
  const seen = new Set<string>();
  let rootFolder: string | null = null;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.id !== pageId) chain.unshift(cur.title);
    if (cur.parentPageId) cur = byId.get(cur.parentPageId);
    else {
      rootFolder = cur.folderId;
      break;
    }
  }
  return [...folderPath(rootFolder, folders), ...chain];
}

/** All folder ids in the subtree rooted at `rootId` (inclusive). */
export function folderSubtree(rootId: string, folders: FolderMeta[]): Set<string> {
  const out = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) (out.add(f.id), (grew = true));
  }
  return out;
}

/** All page ids in the subtree of `rootPageIds` plus every page that lives in the given folders (and their child pages). */
export function pageSubtree(rootPageIds: Iterable<string>, folderIds: Set<string>, pages: PageMeta[]): Set<string> {
  const out = new Set<string>(rootPageIds);
  for (const p of pages) if (p.folderId && folderIds.has(p.folderId)) out.add(p.id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) if (p.parentPageId && out.has(p.parentPageId) && !out.has(p.id)) (out.add(p.id), (grew = true));
  }
  return out;
}
