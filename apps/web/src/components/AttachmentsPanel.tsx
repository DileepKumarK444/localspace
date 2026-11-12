import { useEffect, useRef, useState } from 'react';
import { ExternalLink, ImagePlus, Paperclip, Trash2, Upload } from 'lucide-react';
import type { AttachmentInfo } from '@localspace/shared';
import { api } from '../api/client';
import { useUi } from '../store/ui';

const fmt = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp|avif)$/;

export default function AttachmentsPanel({ pageId, refreshKey, onUpload, onInsertImage, onChanged }: {
  pageId: string; refreshKey: number; onUpload: () => void; onInsertImage: (a: AttachmentInfo) => void; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AttachmentInfo[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { toast, askConfirm } = useUi.getState();

  useEffect(() => { api.attachments(pageId).then(setItems).catch(() => setItems([])); }, [pageId, refreshKey]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  const remove = (a: AttachmentInfo) =>
    askConfirm({
      title: `Delete “${a.filename}”?`,
      message: 'The file is removed from this page. If it is embedded in the text, it will no longer display.',
      confirmLabel: 'Delete file',
      onConfirm: async () => {
        try { await api.deleteAttachment(a.id); onChanged(); toast('Attachment deleted'); } catch (e) { toast((e as Error).message, 'error'); }
      },
    });

  return (
    <div className="pop" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''}`} aria-label="Attachments" title="Attachments" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ width: 'auto', padding: '0 8px', gap: 4, display: 'flex', alignItems: 'center' }}>
        <Paperclip className="ic" />{items && items.length > 0 && <span style={{ fontSize: 12 }}>{items.length}</span>}
      </button>
      {open && (
        <div className="pop-panel att-panel" style={{ right: 0, left: 'auto' }}>
          <div className="att-head"><b>Attachments</b><button className="btn sm primary" onClick={() => { setOpen(false); onUpload(); }}><Upload className="ic" />Upload</button></div>
          {items === null && <div className="empty" style={{ padding: 16 }}>Loading…</div>}
          {items?.length === 0 && <div className="empty" style={{ padding: 16 }}>No files yet. Drag a file into the page, paste an image, or upload.</div>}
          {items?.map((a) => (
            <div key={a.id} className="att-row">
              {INLINE_IMAGE.test(a.mime) ? <img src={a.url} alt="" className="att-thumb" /> : <span className="att-thumb file"><Paperclip className="ic" /></span>}
              <span className="att-name"><span title={a.filename}>{a.filename}</span><small>{fmt(a.size)}</small></span>
              {INLINE_IMAGE.test(a.mime) && <button className="icon-btn" aria-label="Insert into page" title="Insert into page" onClick={() => { onInsertImage(a); setOpen(false); }}><ImagePlus className="ic" /></button>}
              <a className="icon-btn" href={a.url} target="_blank" rel="noreferrer" aria-label="Open" title="Open / download"><ExternalLink className="ic" /></a>
              <button className="icon-btn" aria-label="Delete attachment" title="Delete" onClick={() => remove(a)}><Trash2 className="ic" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
