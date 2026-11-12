import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActions } from './actions';
import { flushCurrent } from './useAutosave';
import { useTheme } from '../store/theme';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

/** App-wide keyboard shortcuts. Alt-combos use `e.code` so they also work where Alt+letter types a symbol (macOS). */
export function useGlobalShortcuts() {
  const { newPage, newFolder, duplicate, selection } = useActions();
  const navigate = useNavigate();

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) { e.preventDefault(); ui.setSearchOpen(true); return; }
      if (mod && e.key === '/') { e.preventDefault(); ui.setShortcutsOpen(!ui.shortcutsOpen); return; }
      if (e.key === '?' && !mod && !typing(e.target)) { e.preventDefault(); ui.setShortcutsOpen(true); return; }
      if (mod && e.key.toLowerCase() === 's' && !e.shiftKey && !e.altKey) { e.preventDefault(); void flushCurrent.fn?.().then(() => ui.toast('Saved')); return; }
      if (!e.altKey || mod) return;
      switch (e.code) {
        case 'KeyN': e.preventDefault(); void (e.shiftKey ? newFolder(selection) : newPage(selection)); break;
        case 'KeyB': e.preventDefault(); ui.setSidebarOpen(!ui.sidebarOpen); break;
        case 'KeyT': e.preventDefault(); useTheme.getState().cycle(); break;
        case 'KeyH': if (selection?.kind === 'page') { e.preventDefault(); ui.setHistoryFor(selection.id); } break;
        case 'KeyD': if (selection?.kind === 'page') { e.preventDefault(); void duplicate(selection.id); } break;
        case 'KeyF': if (selection?.kind === 'page') { e.preventDefault(); void useTree.getState().toggleFavorite(selection.id); } break;
        default: break;
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [newPage, newFolder, duplicate, selection, navigate]);
}
