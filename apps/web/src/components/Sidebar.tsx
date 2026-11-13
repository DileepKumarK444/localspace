import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, FileText, Folder, FolderPlus, MoreHorizontal, Plus, Search, Settings, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { hrefFor, useActions } from '../lib/actions';
import { indexTree, planDrop, type IndexEntry } from '../lib/dnd';
import { buildTree, filterTree, pathTo, type NodeKind, type TreeItem } from '../lib/tree';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';

function ago(iso: string | null) {
  if (!iso) return 'No backup yet';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'Backed up just now';
  if (m < 60) return `Backed up ${m}m ago`;
  if (m < 60 * 24) return `Backed up ${Math.round(m / 60)}h ago`;
  return `Backed up ${Math.round(m / 1440)}d ago`;
}

function RenameInput({ kind, id, initial }: { kind: NodeKind; id: string; initial: string }) {
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = ref.current?.value.trim() ?? '';
    if (commit && v && v !== initial) void useTree.getState().rename(kind, id, v);
    useUi.getState().setRenaming(null);
  };
  return (
    <input
      ref={ref} className="rename" defaultValue={initial} aria-label="Name"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); }}
      onBlur={() => finish(true)}
    />
  );
}

function TreeNodeView({ item, depth, forceOpen, index }: { item: TreeItem; depth: number; forceOpen: boolean; index: Map<string, IndexEntry> }) {
  const navigate = useNavigate();
  const { selection, requestDelete } = useActions();
  const expanded = useTree((s) => s.expanded);
  const toggle = useTree((s) => s.toggle);
  const expand = useTree((s) => s.expand);
  const renamingId = useUi((s) => s.renamingId);
  const menu = useUi((s) => s.menu);
  const openMenu = useUi((s) => s.openMenu);
  const dnd = useUi((s) => s.dnd);
  const open = forceOpen || !!expanded[item.id];
  const hasKids = item.children.length > 0;
  const selected = selection?.id === item.id;
  const Icon = item.kind === 'folder' ? Folder : FileText;

  return (
    <div role="treeitem" aria-expanded={hasKids ? open : undefined} aria-selected={selected}>
      <div
        className={`node ${item.kind} ${selected ? 'sel' : ''} ${menu?.id === item.id ? 'menu-open' : ''} ${dnd.over?.id === item.id ? `drop-${dnd.over.pos}` : ''} ${dnd.drag?.id === item.id ? 'dragging' : ''}`}
        style={{ paddingLeft: depth * 16 + 4 }}
        tabIndex={0}
        data-node-id={item.id}
        draggable={renamingId !== item.id}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); useUi.getState().setDnd({ drag: { kind: item.kind, id: item.id } }); }}
        onDragEnd={() => useUi.getState().setDnd({ drag: null, over: null })}
        onDragOver={(e) => {
          const drag = useUi.getState().dnd.drag;
          if (!drag) return;
          const r = e.currentTarget.getBoundingClientRect();
          const plan = planDrop(drag, item, (e.clientY - r.top) / r.height, index);
          e.stopPropagation();
          if (!plan) { if (useUi.getState().dnd.over) useUi.getState().setDnd({ over: null }); return; }
          e.preventDefault();
          const cur = useUi.getState().dnd.over;
          if (cur?.id !== item.id || cur.pos !== plan.pos) useUi.getState().setDnd({ over: { id: item.id, pos: plan.pos } });
        }}
        onDrop={(e) => {
          const drag = useUi.getState().dnd.drag;
          if (!drag) return;
          const r = e.currentTarget.getBoundingClientRect();
          const plan = planDrop(drag, item, (e.clientY - r.top) / r.height, index);
          e.preventDefault(); e.stopPropagation();
          useUi.getState().setDnd({ drag: null, over: null });
          if (plan) void useTree.getState().move({ kind: drag.kind, id: drag.id, parent: plan.parent, beforeId: plan.beforeId });
        }}
        onClick={() => { navigate(hrefFor(item.kind, item.id)); if (hasKids && !open) expand([item.id]); }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return; // ignore keys typed inside the rename input
          const nodes = [...document.querySelectorAll<HTMLElement>('[role=tree] .node')];
          const i = nodes.indexOf(e.currentTarget);
          if (e.key === 'Enter') navigate(hrefFor(item.kind, item.id));
          else if (e.key === 'F2') useUi.getState().setRenaming(item.id);
          else if (e.key === 'Delete') { e.preventDefault(); requestDelete(item.kind, item.id); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); nodes[i + 1]?.focus(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); nodes[i - 1]?.focus(); }
          else if (e.key === 'ArrowRight' && hasKids) { e.preventDefault(); if (!open) expand([item.id]); else nodes[i + 1]?.focus(); }
          else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (hasKids && open && !forceOpen) toggle(item.id);
            else { const pe = index.get(item.id)?.parent; if (pe) nodes.find((n) => n.dataset.nodeId === pe.id)?.focus(); }
          }
        }}
        onContextMenu={(e) => { e.preventDefault(); openMenu({ x: e.clientX, y: e.clientY, kind: item.kind, id: item.id }); }}
      >
        <button className={`chev ${hasKids ? (open ? 'open' : '') : 'none'}`} tabIndex={-1} aria-label={open ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); toggle(item.id); }}>
          <ChevronRight className="ic" size={14} />
        </button>
        <span className="nico" style={item.color ? { color: item.color } : undefined}><Icon className="ic" /></span>
        {renamingId === item.id ? <RenameInput kind={item.kind} id={item.id} initial={item.title} /> : <span className="label">{item.title}</span>}
        <button className="more" aria-label="More actions" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openMenu({ x: r.right, y: r.bottom + 2, kind: item.kind, id: item.id }); }}>
          <MoreHorizontal className="ic" />
        </button>
      </div>
      {open && hasKids && <div role="group">{item.children.map((c) => <TreeNodeView key={c.id} item={c} depth={depth + 1} forceOpen={forceOpen} index={index} />)}</div>}
    </div>
  );
}

function MiniList({ ids, empty }: { ids: string[]; empty: string }) {
  const pages = useTree((s) => s.pages);
  const { selection } = useActions();
  const navigate = useNavigate();
  const items = ids.map((id) => pages.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  if (!items.length) return <div className="node muted" style={{ paddingLeft: 8 }}>{empty}</div>;
  return (
    <>
      {items.map((p) => (
        <div key={p.id} className={`node ${selection?.id === p.id ? 'sel' : ''}`} style={{ paddingLeft: 8 }} tabIndex={0} onClick={() => navigate(hrefFor('page', p.id))} onKeyDown={(e) => e.key === 'Enter' && navigate(hrefFor('page', p.id))}>
          <span className="nico" style={p.color ? { color: p.color } : undefined}><FileText className="ic" /></span><span className="label">{p.title}</span>
        </div>
      ))}
    </>
  );
}

type SectionKey = 'favorites' | 'recent' | 'pages';
const SECTIONS_KEY = 'localspace.sidebarSections';
const readSections = (): Record<SectionKey, boolean> => {
  try { return { favorites: true, recent: true, pages: true, ...JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') }; } catch { return { favorites: true, recent: true, pages: true }; }
};

/** A sidebar section title that folds its content away; the open/closed state is remembered. */
function SectionHeader({ label, open, count, onToggle, children }: { label: string; open: boolean; count?: number; onToggle: () => void; children?: React.ReactNode }) {
  return (
    <div className="sec">
      <button type="button" className="sec-toggle" aria-expanded={open} onClick={onToggle} title={open ? `Collapse ${label}` : `Expand ${label}`}>
        <ChevronRight className="ic" style={{ width: 12, height: 12, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }} />
        <span>{label}</span>
        {!open && count !== undefined && count > 0 && <span className="sec-count">{count}</span>}
      </button>
      {children}
    </div>
  );
}

export default function Sidebar() {
  const { folders, pages, favorites, recents, loaded } = useTree();
  const { newPage, newFolder, selection } = useActions();
  const [filter, setFilter] = useState('');
  const [sections, setSections] = useState(readSections);
  const toggleSection = (k: SectionKey) => setSections((cur) => {
    const next = { ...cur, [k]: !cur[k] };
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const [backupAt, setBackupAt] = useState<string | null>(null);
  const items = buildTree(folders, pages);
  const shown = filterTree(items, filter);
  const index = indexTree(items);

  // Keep the open item visible: expand its ancestors whenever the selection changes.
  useEffect(() => {
    if (!loaded || !selection) return;
    const t = useTree.getState();
    const anc = pathTo(selection.kind, selection.id, t.folders, t.pages).slice(0, -1).map((p) => p.id);
    if (anc.some((id) => !t.expanded[id])) t.expand(anc);
  }, [loaded, selection?.id, selection?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { api.status().then((s) => setBackupAt(s.lastBackupAt)).catch(() => {}); }, []);

  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="ws">
        <div className="logo">L</div>
        <div><b>My Workspace</b><small>Stored locally · {pages.length} page{pages.length === 1 ? '' : 's'}</small></div>
      </div>
      <div className="sb-actions">
        <label className="sb-search"><Search className="ic" /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter pages" aria-label="Filter pages" /></label>
        <button className="btn primary" title="New page" aria-label="New page" onClick={() => newPage(selection)} style={{ padding: '0 9px' }}><Plus className="ic" /></button>
      </div>
      <div className="sb-scroll">
        <SectionHeader label="Favorites" open={sections.favorites} count={favorites.length} onToggle={() => toggleSection('favorites')} />
        {sections.favorites && <MiniList ids={favorites} empty="Star a page to pin it" />}
        <SectionHeader label="Recently viewed" open={sections.recent} count={recents.length} onToggle={() => toggleSection('recent')} />
        {sections.recent && <MiniList ids={recents} empty="Nothing yet" />}
        <SectionHeader label="Pages" open={sections.pages || !!filter.trim()} count={pages.length} onToggle={() => toggleSection('pages')}>
          <button type="button" className="sec-act" title="New folder" aria-label="New folder" onClick={() => newFolder(null)}><FolderPlus className="ic" /></button>
        </SectionHeader>
        <div
          hidden={!sections.pages && !filter.trim()}
          role="tree" style={{ minHeight: 40 }}
          onDragOver={(e) => { if (useUi.getState().dnd.drag) { e.preventDefault(); } }}
          onDrop={(e) => {
            const drag = useUi.getState().dnd.drag;
            if (!drag) return;
            e.preventDefault();
            useUi.getState().setDnd({ drag: null, over: null });
            void useTree.getState().move({ kind: drag.kind, id: drag.id, parent: null, beforeId: null });
          }}
        >
          {shown.map((i) => <TreeNodeView key={i.id} item={i} depth={0} forceOpen={!!filter.trim()} index={index} />)}
          {loaded && items.length === 0 && <div className="node muted" style={{ paddingLeft: 8 }}>No pages yet — click + to create one</div>}
          {filter.trim() && shown.length === 0 && <div className="node muted" style={{ paddingLeft: 8 }}>No matches</div>}
        </div>
      </div>
      <div className="sb-foot"><span><span className="ok">●</span> {ago(backupAt)}</span><span style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Link to="/trash" className="foot-link"><Trash2 className="ic" />Trash</Link><Link to="/settings" className="foot-link"><Settings className="ic" />Settings</Link></span></div>
    </aside>
  );
}
