import { useState } from 'react';
import { isHex, pushRecentColor, readRecentColors, type Swatch } from '../lib/colors';

/**
 * A colour chooser: a palette grid, a custom colour picker, and the colours used recently.
 * `onPick(null)` means "reset to default" (only offered when `resetLabel` is given).
 */
export default function ColorPanel({ colors, current, onPick, resetLabel, columns = 8 }: {
  colors: Swatch[]; current?: string | null; onPick: (color: string | null) => void; resetLabel?: string; columns?: number;
}) {
  const [custom, setCustom] = useState(current && isHex(current) ? current : '#0c66e4');
  const [recent, setRecent] = useState(readRecentColors);
  const pick = (c: string) => { pushRecentColor(c); setRecent(readRecentColors()); onPick(c); };
  const sw = (s: Swatch) => (
    <button key={s.color + s.name} type="button" className={`swatch ${current?.toLowerCase() === s.color.toLowerCase() ? 'cur' : ''}`} title={s.name} aria-label={s.name}
      style={{ background: s.color }} onClick={() => pick(s.color)} />
  );
  return (
    <div className="color-panel" style={{ ['--cols' as string]: columns }}>
      {resetLabel && <button type="button" className="pop-item" onClick={() => onPick(null)}>{resetLabel}</button>}
      <div className="swatches">{colors.map(sw)}</div>
      {recent.length > 0 && (
        <>
          <div className="pop-label" style={{ padding: '6px 4px 2px' }}>Recent</div>
          <div className="swatches">{recent.map((c) => sw({ name: `Recent ${c}`, color: c }))}</div>
        </>
      )}
      <div className="pop-label" style={{ padding: '6px 4px 2px' }}>Custom colour</div>
      <div className="custom-row">
        <input type="color" aria-label="Pick a custom colour" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <input className="hex" aria-label="Custom colour hex code" value={custom} maxLength={7} spellCheck={false}
          onChange={(e) => setCustom(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)} />
        <button type="button" className="btn sm primary" disabled={!isHex(custom)} onClick={() => pick(custom)}>Apply</button>
      </div>
    </div>
  );
}
