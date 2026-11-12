import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { FilePlus2, FolderPlus, Keyboard, LayoutTemplate, Monitor, Moon, PanelLeft, Plus, Search, Settings, Sun, Trash2, Upload } from 'lucide-react';
import { api } from '../api/client';
import { hrefFor, useActions } from '../lib/actions';
import { MOD } from '../lib/shortcuts';
import { useTheme } from '../store/theme';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';

export default function TopBar() {
  const setSearchOpen = useUi((s) => s.setSearchOpen);
  const { newPage, newFolder, openTemplates, selection } = useActions();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const theme = useTheme();
  const fileInput = useRef<HTMLInputElement>(null);
  const sidebarOpen = useUi((st) => st.sidebarOpen);
  const ThemeIcon = theme.choice === 'dark' ? Moon : theme.choice === 'light' ? Sun : Monitor;

  const importFiles = async (files: File[]) => {
    const { toast } = useUi.getState();
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, markdown: await f.text() })));
      const parent = selection ? { kind: selection.kind, id: selection.id } : null;
      const r = await api.importMarkdown(payload, parent);
      await useTree.getState().load();
      if (parent) useTree.getState().expand([parent.id]);
      toast(`Imported ${r.created.length} page${r.created.length === 1 ? '' : 's'}`);
      if (r.created[0]) navigate(hrefFor('page', r.created[0].id));
    } catch (e) { toast(`Import failed: ${(e as Error).message}`, 'error'); }
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <header className="topbar">
      <button className="icon-btn" aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} title={`Toggle sidebar (Alt+B)`} onClick={() => useUi.getState().setSidebarOpen(!sidebarOpen)}><PanelLeft className="ic" /></button>
      <Link className="brand" to="/" style={{ width: sidebarOpen ? 'calc(var(--sidebar-w) - 24px - 42px)' : 'auto' }}><div className="logo">L</div><span>LocalSpace</span></Link>
      <nav className="tnav" aria-label="Primary">
        <NavLink className={({ isActive }) => `navlink ${isActive ? 'on' : ''}`} to="/" end>Workspace</NavLink>
        <NavLink className={({ isActive }) => `navlink ${isActive ? 'on' : ''}`} to="/activity">Recent</NavLink>
      </nav>
      <button className="gsearch" onClick={() => setSearchOpen(true)} aria-label="Search everything">
        <Search className="ic" /><span className="gs-text">Search everything…</span><kbd>{MOD}K</kbd>
      </button>
      <div className="spacer" ref={ref}>
        <button className="btn primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Plus className="ic" />Create</button>
        {open && (
          <div className="menu" style={{ position: 'absolute', top: 38, right: 80, display: 'block' }} role="menu">
            <button role="menuitem" onClick={() => { setOpen(false); void newPage(selection); }}><FilePlus2 className="ic" />New page</button>
            <button role="menuitem" onClick={() => { setOpen(false); void newFolder(selection); }}><FolderPlus className="ic" />New folder</button>
            <button role="menuitem" onClick={() => { setOpen(false); openTemplates(selection); }}><LayoutTemplate className="ic" />New from template…</button>
            <button role="menuitem" onClick={() => { setOpen(false); fileInput.current?.click(); }}><Upload className="ic" />Import Markdown…</button>
          </div>
        )}
 <input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) void importFiles(f); }} />
        <button className="icon-btn" aria-label={`Theme: ${theme.choice}`} title={`Theme: ${theme.choice} (Alt+T)`} onClick={theme.cycle}><ThemeIcon className="ic" /></button>
        <button className="icon-btn hide-narrow" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => useUi.getState().setShortcutsOpen(true)}><Keyboard className="ic" /></button>
        <Link className="icon-btn hide-narrow" to="/trash" title="Trash" aria-label="Trash"><Trash2 className="ic" /></Link>
        <Link className="icon-btn" to="/settings" title="Settings" aria-label="Settings"><Settings className="ic" /></Link>
        <div className="avatar hide-narrow" aria-hidden>DK</div>
      </div>
    </header>
  );
}
