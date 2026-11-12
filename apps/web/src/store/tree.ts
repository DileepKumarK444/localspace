import { create } from 'zustand';
import type { FolderNode, PageNode } from '@localspace/shared';
import { api } from '../api/client';
import { useUi } from './ui';

const EXPANDED_KEY = 'localspace.expanded';
function loadExpanded(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}'); } catch { return {}; }
}
function saveExpanded(v: Record<string, boolean>) {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

interface TreeState {
  folders: FolderNode[];
  pages: PageNode[];
  favorites: string[];
  recents: string[];
  expanded: Record<string, boolean>;
  loaded: boolean;
  loadError: string | null;
  load: () => Promise<void>;
  toggle: (id: string) => void;
  expand: (ids: string[]) => void;
  createFolder: (parentId: string | null) => Promise<FolderNode | null>;
  createPage: (loc: { folderId?: string | null; parentPageId?: string | null }, opts?: { title?: string; templateId?: string }) => Promise<PageNode | null>;
  duplicate: (id: string) => Promise<PageNode | null>;
  move: (m: Parameters<typeof api.move>[0]) => Promise<boolean>;
  rename: (kind: 'folder' | 'page', id: string, title: string) => Promise<void>;
  remove: (kind: 'folder' | 'page', id: string) => Promise<boolean>;
  toggleFavorite: (id: string) => Promise<void>;
  setColor: (kind: 'folder' | 'page', id: string, color: string | null) => Promise<void>;
  touchRecent: (id: string) => void;
  setPageTitleLocal: (id: string, title: string) => void;
}

export const useTree = create<TreeState>((set, get) => ({
  folders: [], pages: [], favorites: [], recents: [], expanded: loadExpanded(), loaded: false, loadError: null,

  load: async () => {
    try {
      const t = await api.tree();
      set({ folders: t.folders, pages: t.pages, favorites: t.favorites, recents: t.recents, loaded: true, loadError: null });
    } catch (e) {
      set({ loadError: errMsg(e), loaded: true });
    }
  },

  toggle: (id) => {
    const expanded = { ...get().expanded, [id]: !get().expanded[id] };
    saveExpanded(expanded);
    set({ expanded });
  },
  expand: (ids) => {
    const expanded = { ...get().expanded };
    ids.forEach((i) => (expanded[i] = true));
    saveExpanded(expanded);
    set({ expanded });
  },

  createFolder: async (parentId) => {
    try {
      const f = await api.createFolder('New folder', parentId);
      set({ folders: [...get().folders, f] });
      if (parentId) get().expand([parentId]);
      return f;
    } catch (e) { useUi.getState().toast(errMsg(e), 'error'); return null; }
  },

  createPage: async (loc, opts) => {
    try {
      const p = await api.createPage(opts?.title ?? 'Untitled page', loc, opts?.templateId);
      const node: PageNode = { id: p.id, title: p.title, folderId: p.folderId, parentPageId: p.parentPageId, position: p.position, updatedAt: p.updatedAt, color: p.color };
      set({ pages: [...get().pages, node] });
      const parent = loc.folderId ?? loc.parentPageId;
      if (parent) get().expand([parent]);
      return node;
    } catch (e) { useUi.getState().toast(errMsg(e), 'error'); return null; }
  },

  duplicate: async (id) => {
    try {
      const d = await api.duplicatePage(id);
      await get().load();
      return get().pages.find((p) => p.id === d.id) ?? null;
    } catch (e) { useUi.getState().toast(errMsg(e), 'error'); return null; }
  },

  move: async (m) => {
    try {
      await api.move(m);
      if (m.parent) get().expand([m.parent.id]);
      await get().load();
      return true;
    } catch (e) { useUi.getState().toast(errMsg(e), 'error'); return false; }
  },

  rename: async (kind, id, title) => {
    const t = title.trim();
    if (!t) return;
    try {
      if (kind === 'folder') {
        await api.renameFolder(id, t);
        set({ folders: get().folders.map((f) => (f.id === id ? { ...f, name: t } : f)) });
      } else {
        await api.renamePage(id, t);
        get().setPageTitleLocal(id, t);
      }
    } catch (e) { useUi.getState().toast(errMsg(e), 'error'); }
  },

  remove: async (kind, id) => {
    try {
      if (kind === 'folder') await api.deleteFolder(id);
      else await api.deletePage(id);
      await get().load();
      return true;
    } catch (e) { useUi.getState().toast(errMsg(e), 'error'); return false; }
  },

  toggleFavorite: async (id) => {
    const on = !get().favorites.includes(id);
    const before = get().favorites;
    set({ favorites: on ? [...before, id] : before.filter((f) => f !== id) });
    try { await api.setFavorite(id, on); } catch (e) { set({ favorites: before }); useUi.getState().toast(errMsg(e), 'error'); }
  },

  setColor: async (kind, id, color) => {
    const before = { folders: get().folders, pages: get().pages };
    // optimistic: the icon changes immediately, and is put back if the server refuses
    set(kind === 'folder' ? { folders: before.folders.map((f) => (f.id === id ? { ...f, color } : f)) } : { pages: before.pages.map((p) => (p.id === id ? { ...p, color } : p)) });
    try { await (kind === 'folder' ? api.setFolderColor(id, color) : api.setPageColor(id, color)); } catch (e) { set(before); useUi.getState().toast(errMsg(e), 'error'); }
  },

  touchRecent: (id) => {
    set({ recents: [id, ...get().recents.filter((r) => r !== id)].slice(0, 6) });
    api.markViewed(id).catch(() => {});
  },

  setPageTitleLocal: (id, title) => set({ pages: get().pages.map((p) => (p.id === id ? { ...p, title } : p)) }),
}));
