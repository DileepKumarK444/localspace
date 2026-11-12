import { useEffect, useRef, useState } from 'react';
import { Copy, FilePlus2, FolderInput, FolderPlus, LayoutTemplate, Pencil, Star, Trash2 } from 'lucide-react';
import { useActions } from '../lib/actions';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';

/* ---------------- Context menu ---------------- */
export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const openMenu = useUi((s) => s.openMenu);
  const favorites = useTree((s) => s.favorites);
  const { newPage, newFolder, requestDelete, duplicate, openMove, openTemplates } = useActions();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) openMenu(null); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && openMenu(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', () => openMenu(null));
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [menu, openMenu]);

  if (!menu) return null;
  const { kind, id } = menu;
  const target = { kind, id };
  const run = (fn: () => void) => () => { openMenu(null); fn(); };
  const isFav = favorites.includes(id);
  const left = Math.min(menu.x, window.innerWidth - 230);
  const top = Math.min(menu.y, window.innerHeight - 340);

  return (
    <div ref={ref} className="menu" style={{ left, top }} role="menu">
      <button role="menuitem" onClick={run(() => newPage(target))}><FilePlus2 className="ic" />{kind === 'folder' ? 'New page inside' : 'New child page'}</button>
      <button role="menuitem" onClick={run(() => newFolder(target))}><FolderPlus className="ic" />{kind === 'folder' ? 'New subfolder' : 'New folder (alongside)'}</button>
      <button role="menuitem" onClick={run(() => openTemplates(target))}><LayoutTemplate className="ic" />New from template…</button>
      <hr />
      <button role="menuitem" onClick={run(() => useUi.getState().setRenaming(id))}><Pencil className="ic" />Rename<kbd>F2</kbd></button>
      {kind === 'page' && <button role="menuitem" onClick={run(() => void duplicate(id))}><Copy className="ic" />Duplicate</button>}
      <button role="menuitem" onClick={run(() => openMove(kind, id))}><FolderInput className="ic" />Move to…</button>
      {kind === 'page' && (
        <button role="menuitem" onClick={run(() => void useTree.getState().toggleFavorite(id))}><Star className="ic" />{isFav ? 'Remove from favorites' : 'Add to favorites'}</button>
      )}
      <hr />
      <button role="menuitem" className="danger" onClick={run(() => requestDelete(kind, id))}><Trash2 className="ic" />Delete…</button>
    </div>
  );
}

/* ---------------- Confirm dialog ---------------- */
export function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm);
  const askConfirm = useUi((s) => s.askConfirm);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && askConfirm(null);
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [confirm, askConfirm]);
  if (!confirm) return null;
  return (
    <div className="scrim center top" onMouseDown={(e) => e.target === e.currentTarget && askConfirm(null)}>
      <div className="dialog" role="alertdialog" aria-labelledby="cd-title">
        <h3 id="cd-title">{confirm.title}</h3>
        <p>{confirm.message}</p>
        <div className="row">
          <button className="btn ghost" autoFocus onClick={() => askConfirm(null)}>Cancel</button>
          <button className="btn danger" disabled={busy} onClick={async () => { setBusy(true); await confirm.onConfirm(); setBusy(false); askConfirm(null); }}>{confirm.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Toasts ---------------- */
export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  return <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.message}</div>)}</div>;
}
