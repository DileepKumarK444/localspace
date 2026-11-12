import { create } from 'zustand';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'localspace.theme';

function read(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch { /* storage blocked */ }
  return 'system';
}
const resolve = (c: ThemeChoice) => (c === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : c);
const apply = (c: ThemeChoice) => { document.documentElement.dataset.theme = resolve(c); };

interface ThemeState { choice: ThemeChoice; set: (c: ThemeChoice) => void; cycle: () => void }

export const useTheme = create<ThemeState>((set, get) => ({
  choice: read(),
  set: (choice) => {
    try { localStorage.setItem(KEY, choice); } catch { /* ignore */ }
    apply(choice);
    set({ choice });
  },
  cycle: () => get().set(get().choice === 'light' ? 'dark' : get().choice === 'dark' ? 'system' : 'light'),
}));

/** Keeps "system" in sync with the OS setting while the app is open. */
export function watchSystemTheme() {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const h = () => { if (useTheme.getState().choice === 'system') apply('system'); };
  mq.addEventListener('change', h);
  apply(useTheme.getState().choice);
  return () => mq.removeEventListener('change', h);
}
