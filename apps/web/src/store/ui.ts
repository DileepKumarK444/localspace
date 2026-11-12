import { create } from 'zustand';
import type { NodeKind } from '../lib/tree';

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}
export interface MenuState { x: number; y: number; kind: NodeKind; id: string }
export type DialogState = { kind: 'move'; itemKind: 'folder' | 'page'; id: string } | { kind: 'template'; parent: { kind: 'folder' | 'page'; id: string } | null } | null;
export interface DndState { drag: { kind: NodeKind; id: string } | null; over: { id: string; pos: 'before' | 'inside' | 'after' } | null }
export interface PromptState { title: string; label: string; initial?: string; confirmLabel: string; placeholder?: string; onSubmit: (value: string) => void | Promise<void> }
export interface Toast { id: number; message: string; tone: 'info' | 'error' }

interface UiState {
  searchOpen: boolean;
  menu: MenuState | null;
  confirm: ConfirmState | null;
  renamingId: string | null;
  toasts: Toast[];
  dialog: DialogState;
  prompt: PromptState | null;
  shortcutsOpen: boolean;
  sidebarOpen: boolean;
  historyFor: string | null;
  reloadNonce: number;
  bumpReload: () => void;
  setPrompt: (p: PromptState | null) => void;
  setShortcutsOpen: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  setHistoryFor: (id: string | null) => void;
  dnd: DndState;
  setDnd: (d: Partial<DndState>) => void;
  setDialog: (d: DialogState) => void;
  setSearchOpen: (v: boolean) => void;
  openMenu: (m: MenuState | null) => void;
  askConfirm: (c: ConfirmState | null) => void;
  setRenaming: (id: string | null) => void;
  toast: (message: string, tone?: Toast['tone']) => void;
}

let toastId = 0;
export const useUi = create<UiState>((set, get) => ({
  searchOpen: false,
  menu: null,
  confirm: null,
  renamingId: null,
  toasts: [],
  dialog: null,
  prompt: null,
  shortcutsOpen: false,
  sidebarOpen: typeof window === 'undefined' || window.innerWidth > 900,
  historyFor: null,
  reloadNonce: 0,
  bumpReload: () => set({ reloadNonce: get().reloadNonce + 1 }),
  setPrompt: (prompt) => set({ prompt }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setHistoryFor: (historyFor) => set({ historyFor }),
  dnd: { drag: null, over: null },
  setDnd: (d) => set({ dnd: { ...get().dnd, ...d } }),
  setDialog: (dialog) => set({ dialog }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  openMenu: (menu) => set({ menu }),
  askConfirm: (confirm) => set({ confirm }),
  setRenaming: (renamingId) => set({ renamingId }),
  toast: (message, tone = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), tone === 'error' ? 6000 : 3000);
  },
}));
