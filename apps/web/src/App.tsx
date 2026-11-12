import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ActivityPage from './components/ActivityPage';
import Dialogs from './components/Dialogs';
import ErrorBoundary from './components/ErrorBoundary';
import FolderView from './components/FolderView';
import { ConfirmDialog, ContextMenu, Toaster } from './components/Overlays';
import { PromptDialog, ShortcutsDialog } from './components/MoreDialogs';
import { SearchPage, SearchPalette } from './components/Search';
import PageView from './components/PageView';
import SettingsPage from './components/SettingsPage';
import Sidebar from './components/Sidebar';
import TrashPage from './components/TrashPage';
import TopBar from './components/TopBar';
import VersionHistory from './components/VersionHistory';
import { useActions } from './lib/actions';
import { useGlobalShortcuts } from './lib/useGlobalShortcuts';
import { watchSystemTheme } from './store/theme';
import { useTree } from './store/tree';
import { useUi } from './store/ui';

function Home() {
  const { pages, recents, favorites, loaded } = useTree();
  const { newPage } = useActions();
  if (!loaded) return <div className="center-msg">Loading…</div>;
  const exists = (id: string) => pages.some((p) => p.id === id);
  const first = recents.find(exists) ?? favorites.find(exists) ?? pages[0]?.id;
  if (first) return <Navigate to={`/page/${first}`} replace />;
  return (
    <div className="center-msg"><div>
      <h2 style={{ fontSize: 20, color: 'var(--text)', marginBottom: 6 }}>Welcome to LocalSpace</h2>
      <p style={{ marginBottom: 14 }}>Your workspace is empty. Create your first page.</p>
      <button className="btn primary" onClick={() => void newPage(null)}>Create a page</button>
    </div></div>
  );
}

export default function App() {
  const { load, loadError, loaded } = useTree();
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const { pathname } = useLocation();
  useGlobalShortcuts();

  useEffect(() => { void load(); }, [load]);
  useEffect(() => watchSystemTheme(), []);

  // Narrow screens: the sidebar is an overlay drawer — close it after navigating, and follow the breakpoint when resizing.
  useEffect(() => {
    if (window.matchMedia('(max-width: 900px)').matches) useUi.getState().setSidebarOpen(false);
  }, [pathname]);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const h = () => useUi.getState().setSidebarOpen(!mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return (
    <div className="app">
      <TopBar />
      <div className="shell">
        {sidebarOpen && <><div className="sidebar-scrim" onClick={() => useUi.getState().setSidebarOpen(false)} /><Sidebar /></>}
        <main className="main" id="main">
          {loaded && loadError ? (
            <div className="center-msg"><div>
              <h2 style={{ fontSize: 18, color: 'var(--text)', marginBottom: 6 }}>Can’t reach the LocalSpace server</h2>
              <p style={{ marginBottom: 12 }}>{loadError}</p>
              <button className="btn primary" onClick={() => void load()}>Retry</button>
            </div></div>
          ) : (
            <ErrorBoundary key={pathname}><Routes>
              <Route path="/" element={<Home />} />
              <Route path="/trash" element={<TrashPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/page/:id" element={<PageView />} />
              <Route path="/folder/:id" element={<FolderView />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes></ErrorBoundary>
          )}
        </main>
      </div>
      <ContextMenu />
      <ConfirmDialog />
      <Dialogs />
      <PromptDialog />
      <ShortcutsDialog />
      <VersionHistory />
      <SearchPalette />
      <Toaster />
    </div>
  );
}
