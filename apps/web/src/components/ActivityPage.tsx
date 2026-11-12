import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Copy, FilePlus2, History, Pencil, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { ActivityItem, ActivityType } from '@localspace/shared';
import { api } from '../api/client';
import { hrefFor } from '../lib/actions';

const META: Record<ActivityType, { label: string; icon: typeof Pencil }> = {
  created: { label: 'created', icon: FilePlus2 },
  edited: { label: 'edited', icon: Pencil },
  renamed: { label: 'renamed', icon: Pencil },
  moved: { label: 'moved', icon: ArrowRightLeft },
  deleted: { label: 'deleted', icon: Trash2 },
  restored: { label: 'restored', icon: RotateCcw },
  duplicated: { label: 'duplicated', icon: Copy },
  imported: { label: 'imported', icon: Upload },
  version_restored: { label: 'restored an earlier version of', icon: History },
};
const FILTERS: [string, string][] = [['', 'All'], ['edited', 'Edited'], ['created', 'Created'], ['moved', 'Moved'], ['renamed', 'Renamed'], ['deleted', 'Deleted'], ['restored', 'Restored']];

const dayKey = (d: Date) => d.toDateString();
function dayLabel(d: Date) {
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
function rel(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ActivityPage() {
  const [type, setType] = useState('');
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const PAGE = 40;

  const load = useCallback(async (t: string) => {
    try { const r = await api.activity({ limit: PAGE, type: t || undefined }); setItems(r); setMore(r.length === PAGE); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { setItems(null); void load(type); }, [type, load]);

  const loadMore = async () => {
    if (!items?.length) return;
    try { const r = await api.activity({ limit: PAGE, type: type || undefined, before: items[items.length - 1].createdAt }); setItems([...items, ...r]); setMore(r.length === PAGE); } catch (e) { setError((e as Error).message); }
  };

  const groups: { label: string; rows: ActivityItem[] }[] = [];
  for (const it of items ?? []) {
    const label = dayLabel(new Date(it.createdAt));
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.rows.push(it); else groups.push({ label, rows: [it] });
  }

  return (
    <div className="doc">
      <h1 className="title" style={{ fontSize: 28 }}>Recent activity</h1>
      <div className="meta"><span>What changed in your workspace, newest first. Repeated edits to the same page are combined.</span></div>
      <div className="filters" style={{ padding: '0 0 6px', border: 0 }}>
        {FILTERS.map(([v, l]) => <button key={v} className={`chip ${type === v ? 'on' : ''}`} onClick={() => setType(v)}>{l}</button>)}
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {items === null && !error && <p className="empty">Loading…</p>}
      {items?.length === 0 && <p className="empty">Nothing here yet.</p>}
      {groups.map((g) => (
        <div key={g.label}>
          <div className="act-day">{g.label}</div>
          <div className="list">
            {g.rows.map((a) => {
              const { label, icon: Icon } = META[a.type] ?? META.edited;
              return (
                <div key={a.id} className="act-row">
                  <span className={`act-dot ${a.type}`}><Icon className="ic" /></span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ color: 'var(--text-2)' }}>You {label} {a.kind === 'folder' ? 'folder ' : ''}</span>
                    {a.exists ? <Link to={hrefFor(a.kind, a.entityId)}>{a.title}</Link> : <span style={{ fontWeight: 600 }}>{a.title}{a.type !== 'deleted' && ' (no longer exists)'}</span>}
                  </span>
                  <span className="when" title={new Date(a.createdAt).toLocaleString()}>{rel(a.createdAt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {more && <div style={{ textAlign: 'center', marginTop: 16 }}><button className="btn ghost" onClick={() => void loadMore()}>Load more</button></div>}
    </div>
  );
}
