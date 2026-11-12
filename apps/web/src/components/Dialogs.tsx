import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, FileText, Folder, Home, RefreshCw, Scale, Target, Trash2, Users } from 'lucide-react';
import { TEMPLATE_VARIABLES, type TemplateInfo } from '@localspace/shared';
import { api } from '../api/client';
import { hrefFor } from '../lib/actions';
import { subtreeIds } from '../lib/dnd';
import { buildTree, type TreeItem } from '../lib/tree';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';

const ICONS: Record<string, typeof FileText> = { file: FileText, users: Users, target: Target, scale: Scale, book: BookOpen, refresh: RefreshCw };

function useEscape(onClose: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
}

function MoveDialog({ itemKind, id }: { itemKind: 'folder' | 'page'; id: string }) {
  const { folders, pages, move } = useTree();
  const setDialog = useUi((s) => s.setDialog);
  const close = () => setDialog(null);
  useEscape(close);
  const tree = buildTree(folders, pages);
  const find = (list: TreeItem[]): TreeItem | null => { for (const i of list) { if (i.id === id) return i; const f = find(i.children); if (f) return f; } return null; };
  const self = find(tree);
  const blocked = self ? subtreeIds(self) : new Set<string>();
  const parentOf = (list: TreeItem[], parent: TreeItem | null): TreeItem | null | undefined => { for (const i of list) { if (i.id === id) return parent; const r = parentOf(i.children, i); if (r !== undefined) return r; } return undefined; };
  const current = parentOf(tree, null)?.id ?? null;
  const [dest, setDest] = useState<{ kind: 'folder' | 'page'; id: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const rows = (list: TreeItem[], depth: number): React.ReactNode =>
    list.map((i) => {
      if (itemKind === 'folder' && i.kind === 'page') return null;
      const disabled = blocked.has(i.id);
      const selected = dest?.id === i.id;
      return (
        <div key={i.id}>
          <button type="button" disabled={disabled} className={`dest ${selected ? 'sel' : ''}`} style={{ paddingLeft: 10 + depth * 16 }} onClick={() => setDest({ kind: i.kind, id: i.id })}>
            {i.kind === 'folder' ? <Folder className="ic" /> : <FileText className="ic" />}<span>{i.title}</span>{i.id === current && <small>current</small>}
          </button>
          {rows(i.children, depth + 1)}
        </div>
      );
    });

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-label="Move to" style={{ width: 480 }}>
        <h3>Move “{self?.title}” to…</h3>
        <div className="dest-list">
          <button type="button" className={`dest ${dest === null ? 'sel' : ''}`} onClick={() => setDest(null)}><Home className="ic" /><span>Workspace root</span>{current === null && <small>current</small>}</button>
          {rows(tree, 1)}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" disabled={dest === undefined || busy} onClick={async () => { setBusy(true); const ok = await move({ kind: itemKind, id, parent: dest ?? null }); setBusy(false); if (ok) { useUi.getState().toast('Moved'); close(); } }}>Move here</button>
        </div>
      </div>
    </div>
  );
}

function TemplateDialog({ parent }: { parent: { kind: 'folder' | 'page'; id: string } | null }) {
  const navigate = useNavigate();
  const setDialog = useUi((s) => s.setDialog);
  const [items, setItems] = useState<TemplateInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const close = () => setDialog(null);
  useEscape(close);
  useEffect(() => { api.templates().then(setItems).catch((e) => setErr(e.message)); }, []);

  const pick = async (t: TemplateInfo) => {
    const loc = !parent ? {} : parent.kind === 'folder' ? { folderId: parent.id } : { parentPageId: parent.id };
    const page = await useTree.getState().createPage(loc, { title: t.id === 'blank' ? 'Untitled page' : t.name, templateId: t.id });
    close();
    if (page) { navigate(hrefFor('page', page.id)); useUi.getState().setRenaming(page.id); }
  };

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-label="New page from template" style={{ width: 620 }}>
        <h3>New page from template</h3>
        {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
        {!items && !err && <p>Loading…</p>}
        <div className="tpl-grid">
          {items?.map((t) => {
            const Icon = ICONS[t.icon] ?? FileText;
            return (
              <div key={t.id} className="tpl-wrap">
                <button type="button" className="tpl" onClick={() => void pick(t)}><Icon className="ic" /><b>{t.name}</b><small>{t.description || (t.custom ? 'Your template' : '')}</small>{t.custom && <span className="pill" style={{ marginLeft: 0, marginTop: 4 }}>custom</span>}</button>
                {t.custom && <button type="button" className="icon-btn tpl-del" aria-label={`Delete template ${t.name}`} title="Delete template" onClick={() => useUi.getState().askConfirm({
                  title: `Delete template “${t.name}”?`, message: 'Pages already created from it are not affected.', confirmLabel: 'Delete template',
                  onConfirm: async () => { try { await api.deleteTemplate(t.id); setItems((cur) => cur?.filter((x) => x.id !== t.id) ?? cur); } catch (e) { useUi.getState().toast((e as Error).message, 'error'); } },
                })}><Trash2 className="ic" /></button>}
              </div>
            );
          })}
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--text-3)' }}>Templates can contain placeholders that are filled in when the page is created: {TEMPLATE_VARIABLES.map((v) => <code key={v} style={{ marginRight: 4 }}>{v}</code>)}. Use <b>Save as template…</b> in a page's ⋯ menu to make your own.</p>
        <div className="row" style={{ marginTop: 16 }}><button className="btn ghost" onClick={close}>Cancel</button></div>
      </div>
    </div>
  );
}

export default function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  if (!dialog) return null;
  if (dialog.kind === 'move') return <MoveDialog key={dialog.id} itemKind={dialog.itemKind} id={dialog.id} />;
  return <TemplateDialog parent={dialog.parent} />;
}
