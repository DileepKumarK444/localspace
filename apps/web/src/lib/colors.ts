export interface Swatch { name: string; color: string }

/** 8 hues × 4 shades (dark → light). */
const HUES: [string, string[]][] = [
  ['Red', ['#a5200f', '#c9372c', '#f15b50', '#ffa59c']],
  ['Orange', ['#a54800', '#c25100', '#f38a3f', '#fec195']],
  ['Yellow', ['#946f00', '#b38600', '#e2b203', '#f5e05a']],
  ['Green', ['#216e4e', '#1f845a', '#4bce97', '#9be4c4']],
  ['Teal', ['#206a83', '#2898bd', '#6cc3e0', '#b1e4f4']],
  ['Blue', ['#0055cc', '#0c66e4', '#579dff', '#a6c5ff']],
  ['Purple', ['#5e4db2', '#6554c0', '#9f8fef', '#d4cbfa']],
  ['Pink', ['#943d73', '#c1408f', '#e774bb', '#f9b5dc']],
];
const SHADE = ['Dark', '', 'Medium', 'Light'];
const GRAYS: Swatch[] = [
  { name: 'Black', color: '#172b4d' }, { name: 'Dark gray', color: '#44546f' }, { name: 'Gray', color: '#6b778c' }, { name: 'Light gray', color: '#97a0af' },
];

/** Text colours (the first entry resets to the default). Grid is 8 columns wide. */
export const TEXT_COLORS: Swatch[] = [
  ...GRAYS,
  { name: 'Brown', color: '#7a4a2b' }, { name: 'Olive', color: '#5b6b1e' }, { name: 'Navy', color: '#1d3a6e' }, { name: 'Plum', color: '#5a2a5e' },
  ...HUES.flatMap(([n, shades]) => shades.map((c, i) => ({ name: `${SHADE[i]} ${n}`.trim(), color: c }))),
];

/** Soft backgrounds for highlights and table cells. */
export const TINT_COLORS: Swatch[] = [
  { name: 'White', color: '#ffffff' }, { name: 'Very light gray', color: '#f1f2f4' }, { name: 'Light gray', color: '#e6e9ee' }, { name: 'Gray', color: '#c1c7d0' },
  { name: 'Cream', color: '#fdf3d5' }, { name: 'Sand', color: '#efe4d3' }, { name: 'Mint', color: '#dcf5ea' }, { name: 'Sky', color: '#dbeefa' },
  ...HUES.flatMap(([n, shades]) => [
    { name: `Light ${n}`, color: shades[3] },
    { name: `Pale ${n}`, color: tint(shades[3]) },
  ]),
];
function tint(hex: string) {
  // blend 55% towards white for a very pale background
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.55);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Saturated colours that read well on the sidebar for folder and page icons. */
export const ICON_COLORS: Swatch[] = [
  { name: 'Gray', color: '#8590a2' }, { name: 'Slate', color: '#44546f' }, { name: 'Brown', color: '#a18072' }, { name: 'Black', color: '#3b444c' },
  { name: 'Red', color: '#e5484d' }, { name: 'Orange', color: '#f76808' }, { name: 'Amber', color: '#e5a50a' }, { name: 'Yellow', color: '#d6b300' },
  { name: 'Lime', color: '#84a30b' }, { name: 'Green', color: '#30a46c' }, { name: 'Teal', color: '#12a594' }, { name: 'Cyan', color: '#00a2c7' },
  { name: 'Blue', color: '#0c66e4' }, { name: 'Indigo', color: '#3e63dd' }, { name: 'Purple', color: '#8e4ec6' }, { name: 'Pink', color: '#d6409f' },
];

const RECENT_KEY = 'localspace.recentColors';
export const readRecentColors = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } };
export const pushRecentColor = (c: string) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([c.toLowerCase(), ...readRecentColors().filter((x) => x !== c.toLowerCase())].slice(0, 8))); } catch { /* storage blocked */ }
};
export const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);
