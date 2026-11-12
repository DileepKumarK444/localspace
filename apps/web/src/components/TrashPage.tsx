import { useCallback, useEffect, useState } from 'react';
import { FileText, Folder, RotateCcw, Trash2 } from 'lucide-react';
import type { TrashItem } from '@localspace/shared';
import { api } from '../api/client';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';

export default function TrashPage() {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast, askConfirm } = useUi.getState();

  const load = useCallback(() => api.trash().then((t) => { setItems(t); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const restore = async (i: TrashItem) => {
    try { await api.restoreTrash(i.kind, i.id); await Promise.all([load(), useTree.getState().load()]); toast(`Restored “${i.title}”`); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const purge = (i: TrashItem) => askConfirm({
    title: `Permanently delete “${i.title}”?`,
    message: `${i.childCount ? `This also deletes ${i.childCount} item${i.childCount > 1 ? 's' : ''} inside it. ` : ''}This cannot be undone.`,
    confirmLabel: 'Delete forever',
    onConfirm: async () => { try { await api.purgeTrash(i.kind, i.id); await load(); } catch (e) { toast((e as Error).message, 'error'); } },
  });
  const empty = () => askConfirm({
    title: 'Empty trash?', message: `All ${items?.length ?? 0} item(s) in the trash will be permanently deleted. This cannot be undone.`, confirmLabel: 'Empty trash',
    onConfirm: async () => { try { await api.emptyTrash(); await load(); } catch (e) { toast((e as Error).message, 'error'); } },
  });

  return (
    <div className="doc">
      <h1 className="title" style={{ fontSize: 28 }}>Trash</h1>
      <div className="meta"><span>Deleted items are kept for 30 days, then removed automatically.</span></div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {items === null && !error && <p className="empty">Loading…</p>}
      {items?.length === 0 && <p className="empty">The trash is empty.</p>}
      {items && items.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}><button className="btn ghost" onClick={empty}><Trash2 className="ic" />Empty trash</button></div>
          <div className="list">
            {items.map((i) => (
              <div key={`${i.kind}:${i.id}`} className="list-row">
                <span style={{ color: 'var(--text-3)', display: 'grid' }}>{i.kind === 'folder' ? <Folder className="ic" /> : <FileText className="ic" />}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{i.title}</b>
                  <small style={{ display: 'block', color: 'var(--text-3)' }}>Deleted {new Date(i.deletedAt).toLocaleString()}{i.childCount ? ` · with ${i.childCount} item${i.childCount > 1 ? 's' : ''} inside` : ''}</small>
                </span>
                <button className="btn sm ghost" onClick={() => void restore(i)}><RotateCcw className="ic" />Restore</button>
                <button className="btn sm ghost danger-text" onClick={() => purge(i)}>Delete forever</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
