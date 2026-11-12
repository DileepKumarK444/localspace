import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Clock, FileText, Folder, Paperclip, Search as SearchIcon, X } from 'lucide-react';
import type { SearchResponse, SearchSort, SearchType } from '@localspace/shared';
import { api } from '../api/client';
import { hrefFor, useSelection } from '../lib/actions';
import { pathTo, type NodeKind } from '../lib/tree';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';

/* ---------- shared bits ---------- */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/);
  return <>{parts.map((p, i) => (p.startsWith('\u0001') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}</>;
}

/** Highlights the positive search words inside `text` (quotes and -exclusions are ignored). */
export function Highlight({ text, q }: { text: string; q: string }) {
  const tokens = [...q.matchAll(/(-?)"([^"]*)"|(-?)([^\s"]+)/g)]
    .filter((m) => !(m[1] || m[3]))
    .map((m) => (m[2] ?? m[4] ?? '').replace(/\*+$/, '').trim())
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return <>{text}</>;
  const re = new RegExp(`(${tokens.join('|')})`, 'ig');
  return <>{text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}</>;
}

const RECENT_KEY = 'localspace.recentSearches';
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } };
const pushRecent = (q: string) => {
  const t = q.trim();
  if (!t) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([t, ...readRecent().filter((x) => x !== t)].slice(0, 6))); } catch { /* ignore */ }
};

type Row = { key: string; kind: 'page' | 'folder' | 'attachment'; target: { kind: NodeKind; id: string }; title: string; path: string[]; snippet?: string; sub?: string };

export function toRows(r: SearchResponse): Row[] {
  return [
    ...r.pages.map((p) => ({ key: `p${p.id}`, kind: 'page' as const, target: { kind: 'page' as const, id: p.id }, title: p.title, path: p.path, snippet: p.snippet })),
    ...r.folders.map((f) => ({ key: `f${f.id}`, kind: 'folder' as const, target: { kind: 'folder' as const, id: f.id }, title: f.name, path: f.path })),
    ...r.attachments.map((a) => ({ key: `a${a.id}`, kind: 'attachment' as const, target: { kind: 'page' as const, id: a.pageId }, title: a.filename, path: a.path, sub: `Attached to ${a.pageTitle}` })),
  ];
}

const ICON = { page: FileText, folder: Folder, attachment: Paperclip } as const;
const SECTION = { page: 'Pages', folder: 'Folders', attachment: 'Files' } as const;
const TYPES: [SearchType, string][] = [['all', 'All'], ['pages', 'Pages'], ['folders', 'Folders'], ['attachments', 'Files']];

/** Folder the user is "in": the selected folder, or the nearest folder above the selected page. */
function useScopeCandidate() {
  const selection = useSelection();
  const folders = useTree((s) => s.folders);
  const pages = useTree((s) => s.pages);
  return useMemo(() => {
    if (!selection) return null;
    const chain = pathTo(selection.kind, selection.id, folders, pages).filter((p) => p.kind === 'folder');
    const f = chain[chain.length - 1];
    return f ? { id: f.id, name: f.title } : null;
  }, [selection, folders, pages]);
}

function openTarget(navigate: ReturnType<typeof useNavigate>, t: { kind: NodeKind; id: string }) {
  const { folders, pages, expand } = useTree.getState();
  expand(pathTo(t.kind, t.id, folders, pages).slice(0, -1).map((p) => p.id));
  navigate(hrefFor(t.kind, t.id));
}

function ResultRow({ row, q, active, onHover, onClick }: { row: Row; q: string; active?: boolean; onHover?: () => void; onClick: () => void }) {
  const Icon = ICON[row.kind];
  return (
    <button className={`res ${active ? 'act' : ''}`} onMouseEnter={onHover} onClick={onClick}>
      <span className="rico"><Icon className="ic" /></span>
      <span style={{ minWidth: 0 }}>
        <b><Highlight text={row.title} q={q} /></b>
        <span className="path" style={{ display: 'block' }}>{['My Workspace', ...row.path].join(' › ')}{row.sub ? ` · ${row.sub}` : ''}</span>
        {row.snippet && <span className="snip" style={{ display: 'block' }}><Snippet text={row.snippet} /></span>}
      </span>
    </button>
  );
}

/* ---------- ⌘K palette ---------- */
export function SearchPalette() {
  const open = useUi((s) => s.searchOpen);
  const setOpen = useUi((s) => s.setSearchOpen);
  const navigate = useNavigate();
  const scopeCandidate = useScopeCandidate();
  const recentPages = useTree((s) => s.recents);
  const pages = useTree((s) => s.pages);
  const [q, setQ] = useState('');
  const [type, setType] = useState<SearchType>('all');
  const [scoped, setScoped] = useState(false);
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [recentQ, setRecentQ] = useState<string[]>([]);

  // Reset on close (not on open): resetting after opening could overwrite text typed straight away.
  useEffect(() => {
    if (open) setRecentQ(readRecent());
    else { setQ(''); setType('all'); setScoped(false); setRes(null); setErr(null); setActive(0); }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query) { setRes(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api.search(query, { type, scope: scoped ? scopeCandidate?.id : null, limit: 20 }, ctl.signal)
        .then((r) => { setRes(r); setErr(null); setActive(0); })
        .catch((e) => { if (e.name !== 'AbortError') setErr(e.message); });
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, type, scoped, open, scopeCandidate?.id]);

  const rows = res ? toRows(res) : [];
  const go = (row: Row) => { pushRecent(q); setOpen(false); openTarget(navigate, row.target); };
  const viewAll = () => {
    pushRecent(q);
    setOpen(false);
    const qs = new URLSearchParams({ q: q.trim() });
    if (type !== 'all') qs.set('type', type);
    if (scoped && scopeCandidate) qs.set('scope', scopeCandidate.id);
    navigate(`/search?${qs}`);
  };

  if (!open) return null;
  const hasQuery = q.trim().length > 0;
  const recentItems = recentPages.map((id) => pages.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Search">
        <div className="in">
          <SearchIcon className="ic" />
          <input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, content, folders and files…" aria-label="Search"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === 'Enter') { if ((e.metaKey || e.ctrlKey) && hasQuery) viewAll(); else if (rows[active]) go(rows[active]); }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="filters">
          {TYPES.map(([t, label]) => <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>{label}</button>)}
          {scopeCandidate && <button className={`chip scope ${scoped ? 'on' : ''}`} title="Only search inside this folder" onClick={() => setScoped((s) => !s)}><Folder className="ic" style={{ width: 12, height: 12 }} />In “{scopeCandidate.name}”{scoped && <X className="ic" style={{ width: 12, height: 12 }} />}</button>}
        </div>
        <div className="results">
          {err && <div className="empty">Search failed: {err}</div>}
          {!err && !hasQuery && (
            <>
              {recentQ.length > 0 && <div className="res-sec">Recent searches</div>}
              {recentQ.map((r) => <button key={r} className="res" onClick={() => setQ(r)}><span className="rico"><Clock className="ic" /></span><b style={{ fontWeight: 500 }}>{r}</b></button>)}
              {recentItems.length > 0 && <div className="res-sec">Recently viewed</div>}
              {recentItems.slice(0, 4).map((p) => <button key={p.id} className="res" onClick={() => { setOpen(false); openTarget(navigate, { kind: 'page', id: p.id }); }}><span className="rico"><FileText className="ic" /></span><b style={{ fontWeight: 500 }}>{p.title}</b></button>)}
              <div className="empty" style={{ padding: 18 }}>Tip: use <code>"exact phrase"</code> and <code>-exclude</code>.</div>
            </>
          )}
          {!err && hasQuery && res && rows.length === 0 && <div className="empty">No results for “{q.trim()}”</div>}
          {rows.map((r, i) => (
            <div key={r.key}>
              {(i === 0 || rows[i - 1].kind !== r.kind) && <div className="res-sec">{SECTION[r.kind]}</div>}
              <ResultRow row={r} q={q} active={i === active} onHover={() => setActive(i)} onClick={() => go(r)} />
            </div>
          ))}
        </div>
        <div className="pfoot">
          <span>↑↓ navigate</span><span>↵ open</span><span>⌘↵ all results</span><span>esc close</span>
          {hasQuery && res ? <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={viewAll}>View all results ({rows.length}{rows.length >= 20 ? '+' : ''})</button> : <span style={{ marginLeft: 'auto' }} />}
        </div>
      </div>
    </div>
  );
}

/* ---------- full results page ---------- */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get('q') ?? '';
  const type = (params.get('type') as SearchType) || 'all';
  const sort = (params.get('sort') as SearchSort) || 'relevance';
  const scope = params.get('scope');
  const folders = useTree((s) => s.folders);
  const [input, setInput] = useState(q);
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<SearchType, number> | null>(null);

  useEffect(() => setInput(q), [q]);
  useEffect(() => {
    if (!q.trim()) { setRes(null); setCounts(null); return; }
    let alive = true;
    const opts = { scope, sort, limit: 100 };
    Promise.all([api.search(q, { ...opts, type }), api.search(q, { scope, limit: 100 })])
      .then(([r, all]) => {
        if (!alive) return;
        setRes(r); setErr(null);
        setCounts({ all: all.pages.length + all.folders.length + all.attachments.length, pages: all.pages.length, folders: all.folders.length, attachments: all.attachments.length });
      })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [q, type, sort, scope]);

  const set = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n); };
  const rows = res ? toRows(res) : [];
  const scopeName = scope ? folders.find((f) => f.id === scope)?.name ?? 'folder' : null;
  const sections = (['page', 'folder', 'attachment'] as const).filter((k) => rows.some((r) => r.kind === k));

  return (
    <div className="doc" style={{ maxWidth: 900 }}>
      <form onSubmit={(e) => { e.preventDefault(); pushRecent(input); set('q', input.trim() || null); }} className="bigsearch">
        <SearchIcon className="ic" />
        <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search everything…" aria-label="Search query" />
        <button className="btn primary" type="submit">Search</button>
      </form>
      <div className="filters" style={{ padding: '12px 0', border: 0 }}>
        {TYPES.map(([t, label]) => <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => set('type', t === 'all' ? null : t)}>{label}{counts ? ` (${counts[t]})` : ''}</button>)}
        {scopeName && <button className="chip on" onClick={() => set('scope', null)}>In “{scopeName}” <X className="ic" style={{ width: 12, height: 12 }} /></button>}
        <label style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 13 }}>Sort{' '}
          <select className="tb-select" aria-label="Sort results" value={sort} onChange={(e) => set('sort', e.target.value === 'relevance' ? null : e.target.value)}>
            <option value="relevance">Relevance</option><option value="recent">Recently edited</option>
          </select>
        </label>
      </div>
      {err && <p style={{ color: 'var(--danger)' }}>Search failed: {err}</p>}
      {!q.trim() && <p className="empty">Type a query above. Use <code>"exact phrase"</code> and <code>-exclude</code>.</p>}
      {q.trim() && res && rows.length === 0 && <p className="empty">No results for “{q}”.</p>}
      {sections.map((k) => (
        <div key={k} className="list" style={{ marginBottom: 16 }}>
          <div className="res-sec" style={{ padding: '10px 14px 4px' }}>{SECTION[k]}</div>
          {rows.filter((r) => r.kind === k).map((r) => (
            <ResultRow key={r.key} row={r} q={q} onClick={() => openTarget(navigate, r.target)} />
          ))}
        </div>
      ))}
    </div>
  );
}

export type { ReactNode };
