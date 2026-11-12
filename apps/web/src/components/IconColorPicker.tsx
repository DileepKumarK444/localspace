import { useEffect, useRef } from 'react';
import { ICON_COLORS } from '../lib/colors';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';
import ColorPanel from './ColorPanel';

/** Floating chooser for a folder's or page's icon colour (opened from the context menu, page menu or folder header). */
export default function IconColorPicker() {
  const picker = useUi((s) => s.colorPicker);
  const setPicker = useUi((s) => s.setColorPicker);
  const current = useTree((s) => (picker ? (picker.kind === 'folder' ? s.folders.find((f) => f.id === picker.id)?.color : s.pages.find((p) => p.id === picker.id)?.color) ?? null : null));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picker) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setPicker(null); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPicker(null);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [picker, setPicker]);

  if (!picker) return null;
  const left = Math.max(8, Math.min(picker.x, window.innerWidth - 290));
  const top = Math.max(8, Math.min(picker.y, window.innerHeight - 330));
  return (
    <div ref={ref} className="icon-color-pop" style={{ left, top }} role="dialog" aria-label="Icon colour">
      <ColorPanel colors={ICON_COLORS} current={current} resetLabel="Default colour"
        onPick={(c) => { void useTree.getState().setColor(picker.kind, picker.id, c); setPicker(null); }} />
    </div>
  );
}
