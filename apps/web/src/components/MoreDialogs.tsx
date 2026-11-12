import { useEffect, useRef, useState } from 'react';
import { useUi } from '../store/ui';
import { SHORTCUT_GROUPS } from '../lib/shortcuts';

/** Generic single-field prompt (used for naming versions and templates). */
export function PromptDialog() {
  const prompt = useUi((s) => s.prompt);
  const setPrompt = useUi((s) => s.setPrompt);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (prompt) { setValue(prompt.initial ?? ''); setTimeout(() => input.current?.select(), 0); } }, [prompt]);
  if (!prompt) return null;
  const close = () => setPrompt(null);
  return (
    <div className="scrim center top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form className="dialog" role="dialog" aria-label={prompt.title}
        onSubmit={async (e) => { e.preventDefault(); if (!value.trim() || busy) return; setBusy(true); try { await prompt.onSubmit(value.trim()); } finally { setBusy(false); } close(); }}
        onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{prompt.title}</h3>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>{prompt.label}</label>
        <input ref={input} className="field" autoFocus value={value} maxLength={100} placeholder={prompt.placeholder} onChange={(e) => setValue(e.target.value)} />
        <div className="row">
          <button type="button" className="btn ghost" onClick={close}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!value.trim() || busy}>{prompt.confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="dialog" role="dialog" aria-label="Keyboard shortcuts" style={{ width: 640, maxHeight: '80vh', overflow: 'auto' }}>
        <h3>Keyboard shortcuts</h3>
        <div className="sc-grid">
          {SHORTCUT_GROUPS.map((g) => (
            <div key={g.title}>
              <div className="pop-label" style={{ padding: '8px 0 6px' }}>{g.title}</div>
              {g.items.map((it) => (
                <div key={it.desc} className="sc-row"><span>{it.desc}</span><span>{it.keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span></div>
              ))}
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}><button className="btn ghost" onClick={() => setOpen(false)}>Close</button></div>
      </div>
    </div>
  );
}
