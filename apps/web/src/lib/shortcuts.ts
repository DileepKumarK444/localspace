export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';
export const ALT = isMac ? '⌥' : 'Alt';
export const SHIFT = isMac ? '⇧' : 'Shift';

export interface ShortcutDef { keys: string[]; desc: string }
export interface ShortcutGroup { title: string; items: ShortcutDef[] }

/** Single source of truth for the help dialog. Global ones are wired in useGlobalShortcuts; editor ones come from TipTap. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    items: [
      { keys: [MOD, 'K'], desc: 'Search everything' },
      { keys: [MOD, '↵'], desc: 'In search: open all results' },
      { keys: [ALT, 'N'], desc: 'New page' },
      { keys: [ALT, SHIFT, 'N'], desc: 'New folder' },
      { keys: [ALT, 'B'], desc: 'Show / hide sidebar' },
      { keys: [MOD, '/'], desc: 'Keyboard shortcuts' },
      { keys: ['↑', '↓'], desc: 'In the page tree: move between items' },
      { keys: ['→', '←'], desc: 'In the page tree: expand / collapse' },
      { keys: ['F2'], desc: 'In the page tree: rename' },
      { keys: ['Del'], desc: 'In the page tree: delete…' },
    ],
  },
  {
    title: 'Page',
    items: [
      { keys: [MOD, 'S'], desc: 'Save now' },
      { keys: [ALT, 'H'], desc: 'Version history' },
      { keys: [ALT, 'D'], desc: 'Duplicate page' },
      { keys: [ALT, 'F'], desc: 'Add / remove favorite' },
      { keys: [ALT, 'T'], desc: 'Switch theme (light / dark / system)' },
    ],
  },
  {
    title: 'Editor',
    items: [
      { keys: [MOD, 'B'], desc: 'Bold' },
      { keys: [MOD, 'I'], desc: 'Italic' },
      { keys: [MOD, 'U'], desc: 'Underline' },
      { keys: [MOD, SHIFT, 'S'], desc: 'Strikethrough' },
      { keys: [MOD, 'E'], desc: 'Inline code' },
      { keys: [MOD, SHIFT, 'K'], desc: 'Insert / edit link' },
      { keys: [MOD, ALT, '1…3'], desc: 'Heading 1–3' },
      { keys: [MOD, SHIFT, '8'], desc: 'Bulleted list' },
      { keys: [MOD, SHIFT, '7'], desc: 'Numbered list' },
      { keys: [MOD, SHIFT, '9'], desc: 'Task list' },
      { keys: [MOD, SHIFT, 'B'], desc: 'Quote' },
      { keys: [MOD, ALT, 'C'], desc: 'Code block' },
      { keys: [MOD, 'Z'], desc: 'Undo' },
      { keys: [MOD, SHIFT, 'Z'], desc: 'Redo' },
      { keys: ['Tab'], desc: 'In a table: next cell' },
    ],
  },
];
