import { useCallback, useEffect, useState } from 'react';
import { History, Save, Trash2, X } from 'lucide-react';
import type { VersionDetail, VersionInfo } from '@localspace/shared';
import { api } from '../api/client';
import { flushCurrent } from '../lib/useAutosave';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

/** Right-hand drawer: list of saved versions with a read-only preview and restore. */
export default function VersionHistory() {
  const pageId = useUi((s) => s.historyFor);
  const setHistoryFor = useUi((s) => s.setHistoryFor);
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [selected, setSelected] = useState<VersionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast, askConfirm, setPrompt } = useUi.getState();

  const load = useCallback(async (id: string, selectId?: string) => {
    try {
      await flushCurrent.fn?.(); // make sure the latest edits are saved (and snapshotted) before listing
      const v = await api.versions(id);
      setList(v); setError(null);
      const pick = selectId ?? v[0]?.id;
      setSelected(pick ? await api.version(id, pick) : null);
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { setList(null); setSelected(null); if (pageId) void load(pageId); }, [pageId, load]);
  useEffect(() => {
    if (!pageId) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setHistoryFor(null);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [pageId, setHistoryFor]);

  if (!pageId) return null;
  const close = () => setHistoryFor(null);

  const restore = () => selected && askConfirm({
    title: 'Restore this version?',
    message: `The page will go back to how it was on ${when(selected.createdAt)}. Your current content is saved as a “Before restore” version first, so you can undo this.`,
    confirmLabel: 'Restore',
    onConfirm: async () => {
      try {
        await flushCurrent.fn?.();
        const page = await api.restoreVersion(pageId, selected.id);
        useTree.getState().setPageTitleLocal(pageId, page.title);
        useUi.getState().bumpReload();
        toast('Version restored');
        await load(pageId);
      } catch (e) { toast((e as Error).message, 'error'); }
    },
  });
  const saveNow = () => setPrompt({
    title: 'Save a version', label: 'Name (optional)', initial: 'Milestone', confirmLabel: 'Save version',
    onSubmit: async (label) => { try { await flushCurrent.fn?.(); const v = await api.createVersion(pageId, label); toast('Version saved'); await load(pageId, v.id); } catch (e) { toast((e as Error).message, 'error'); } },
  });
  const remove = () => selected && askConfirm({
    title: 'Delete this version?', message: 'Only this saved snapshot is removed; the page itself is not changed.', confirmLabel: 'Delete version',
    onConfirm: async () => { try { await api.deleteVersion(pageId, selected.id); await load(pageId); } catch (e) { toast((e as Error).message, 'error'); } },
  });

  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside className="drawer" role="dialog" aria-label="Version history">
        <div className="drawer-head">
          <b style={{ display: 'flex', gap: 8, alignItems: 'center' }}><History className="ic" />Version history</b>
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm ghost" onClick={saveNow}><Save className="ic" />Save version</button>
            <button className="icon-btn" aria-label="Close history" onClick={close}><X className="ic" /></button>
          </span>
        </div>
        {error && <p style={{ color: 'var(--danger)', padding: 16 }}>{error}</p>}
        <div className="drawer-body">
          <div className="v-list">
            {list === null && !error && <p className="empty">Loading…</p>}
            {list?.length === 0 && <p className="empty">No earlier versions yet. Versions are saved automatically as you edit (at most every 10 minutes) — or save one yourself.</p>}
            {list?.map((v) => (
              <button key={v.id} className={`v-item ${selected?.id === v.id ? 'sel' : ''}`} onClick={() => void api.version(pageId, v.id).then(setSelected).catch((e) => setError(e.message))}>
                <b>{when(v.createdAt)}</b>
                <small>{v.label ? <span className="pill" style={{ marginLeft: 0 }}>{v.label}</span> : 'Automatic'} · {kb(v.size)}</small>
                <small style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.title}</small>
              </button>
            ))}
          </div>
          <div className="v-preview">
            {selected ? (
              <>
                <div className="v-actions">
                  <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Preview · {when(selected.createdAt)}</span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button className="btn sm ghost danger-text" onClick={remove}><Trash2 className="ic" />Delete</button>
                    <button className="btn sm primary" onClick={restore}>Restore this version</button>
                  </span>
                </div>
                <h2 style={{ fontSize: 22, margin: '8px 0 12px' }}>{selected.title}</h2>
                {/* html is produced by the server's escaping renderer (no raw user HTML), see docToHtml */}
                <div className="ProseMirror preview" dangerouslySetInnerHTML={{ __html: selected.html }} />
              </>
            ) : <p className="empty">Select a version to preview it.</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
