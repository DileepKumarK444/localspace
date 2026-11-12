import { useCallback } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';
import { buildTree, pathTo, type NodeKind, type TreeItem } from './tree';

export const hrefFor = (kind: NodeKind, id: string) => `/${kind}/${id}`;

/** The item currently open in the main pane, derived from the URL. */
export function useSelection(): { kind: NodeKind; id: string } | null {
  const page = useMatch('/page/:id');
  const folder = useMatch('/folder/:id');
  if (page?.params.id) return { kind: 'page', id: page.params.id };
  if (folder?.params.id) return { kind: 'folder', id: folder.params.id };
  return null;
}

/** Number of folders/pages strictly inside `item` (all depths). */
const countItems = (item: TreeItem): { folders: number; pages: number } =>
  item.children.reduce(
    (acc, c) => {
      const inner = countItems(c);
      return {
        folders: acc.folders + inner.folders + (c.kind === 'folder' ? 1 : 0),
        pages: acc.pages + inner.pages + (c.kind === 'page' ? 1 : 0),
      };
    },
    { folders: 0, pages: 0 },
  );

const findItem = (items: TreeItem[], id: string): TreeItem | null => {
  for (const i of items) {
    if (i.id === id) return i;
    const f = findItem(i.children, id);
    if (f) return f;
  }
  return null;
};

/** User-level operations shared by the sidebar, context menu and top bar. */
export function useActions() {
  const navigate = useNavigate();
  const selection = useSelection();
  const ui = useUi;

  const newPage = useCallback(
    async (parent: { kind: NodeKind; id: string } | null) => {
      const t = useTree.getState();
      const loc = !parent ? {} : parent.kind === 'folder' ? { folderId: parent.id } : { parentPageId: parent.id };
      const page = await t.createPage(loc);
      if (page) {
        navigate(hrefFor('page', page.id));
        ui.getState().setRenaming(page.id);
      }
    },
    [navigate, ui],
  );

  const newFolder = useCallback(
    async (parent: { kind: NodeKind; id: string } | null) => {
      const t = useTree.getState();
      let parentId: string | null = null;
      if (parent?.kind === 'folder') parentId = parent.id;
      else if (parent?.kind === 'page') {
        const chain = pathTo('page', parent.id, t.folders, t.pages).filter((p) => p.kind === 'folder');
        parentId = chain.length ? chain[chain.length - 1].id : null;
      }
      const f = await t.createFolder(parentId);
      if (f) {
        navigate(hrefFor('folder', f.id));
        ui.getState().setRenaming(f.id);
      }
    },
    [navigate, ui],
  );

  const requestDelete = useCallback(
    (kind: NodeKind, id: string) => {
      const t = useTree.getState();
      const item = findItem(buildTree(t.folders, t.pages), id);
      if (!item) return;
      const n = countItems(item);
      const inside = n.folders + n.pages;
      ui.getState().askConfirm({
        title: `Delete “${item.title}”?`,
        message: inside
          ? `This also deletes ${[n.pages && `${n.pages} page${n.pages > 1 ? 's' : ''}`, n.folders && `${n.folders} folder${n.folders > 1 ? 's' : ''}`].filter(Boolean).join(' and ')} inside it.`
          : `“${item.title}” will be deleted.`,
        confirmLabel: 'Delete',
        onConfirm: async () => {
          const wasOpen = selection && (selection.id === id || (() => {
            // is the open item inside the deleted subtree?
            const inSub = (list: TreeItem[]): boolean => list.some((c) => c.id === selection.id || inSub(c.children));
            return inSub(item.children);
          })());
          const ok = await t.remove(kind, id);
          if (ok) {
            ui.getState().toast(`Deleted “${item.title}”`);
            if (wasOpen) navigate('/');
          }
        },
      });
    },
    [navigate, selection, ui],
  );

  const duplicate = useCallback(
    async (id: string) => {
      const p = await useTree.getState().duplicate(id);
      if (p) { navigate(hrefFor('page', p.id)); ui.getState().toast('Page duplicated'); }
    },
    [navigate, ui],
  );
  const openMove = useCallback((kind: NodeKind, id: string) => ui.getState().setDialog({ kind: 'move', itemKind: kind, id }), [ui]);
  const openTemplates = useCallback((parent: { kind: NodeKind; id: string } | null) => ui.getState().setDialog({ kind: 'template', parent }), [ui]);

  return { newPage, newFolder, requestDelete, duplicate, openMove, openTemplates, selection };
}
