import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EditorContent, Extension, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import LinkExt from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Clock, Copy, FileCode2, FileDown, FileText, FolderInput, History, LayoutTemplate, MoreHorizontal, Star, Trash2 } from 'lucide-react';
import type { AttachmentInfo, PageDetail } from '@localspace/shared';
import { ApiError, api, exportUrl } from '../api/client';
import { Callout, ColorCell, ColorHeader, Expand, ExpandBody, ExpandTitle, FontSize, ResizableImage, lowlight } from '../lib/extensions';
import { TrailingParagraph } from '../lib/trailingParagraph';
import { useActions } from '../lib/actions';
import { clearDraft, flushCurrent, readDraft, useAutosave } from '../lib/useAutosave';
import { ALT } from '../lib/shortcuts';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';
import AttachmentsPanel, { INLINE_IMAGE } from './AttachmentsPanel';
import Breadcrumbs from './Breadcrumbs';
import EditorToolbar from './EditorToolbar';

function SaveStatus({ state, message, onRetry }: { state: string; message: string; onRetry: () => void }) {
  const text = { saved: 'Saved', saving: 'Saving…', error: 'Save failed — retrying', conflict: 'Save blocked' }[state] ?? '';
  return (
    <div className={`status ${state === 'saving' ? 'saving' : state === 'saved' ? '' : 'error'}`} role="status" aria-live="polite" data-testid="save-status" data-state={state}>
      <span className="dot" /><span>{text}</span>
      {state === 'error' && <><span title={message}>· {message}</span><button className="link-btn" onClick={onRetry}>Retry now</button></>}
    </div>
  );
}

function LinkDialog({ initial, onApply, onClose }: { initial: string; onApply: (url: string | null) => void; onClose: () => void }) {
  const [url, setUrl] = useState(initial);
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={(e) => { e.preventDefault(); onApply(url.trim() || null); }} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>Link</h3>
        <input className="field" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" aria-label="Link URL" />
        <div className="row">
          {initial && <button type="button" className="btn ghost" onClick={() => onApply(null)}>Remove link</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Apply</button>
        </div>
      </form>
    </div>
  );
}

function PageMenu({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { duplicate, openMove, requestDelete } = useActions();
  const title = useTree((s) => s.pages.find((p) => p.id === pageId)?.title ?? '');
  const exportAs = async (format: 'md' | 'html' | 'pdf') => {
    // open the print tab synchronously (popup blockers), then make sure the latest edits are saved before exporting
    const w = format === 'pdf' ? window.open('about:blank', '_blank') : null;
    await flushCurrent.fn?.();
    const url = exportUrl(pageId, format);
    if (w) { w.location.href = url; return; }
    const a = document.createElement('a');
    a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
  };
  const saveAsTemplate = () => useUi.getState().setPrompt({
    title: 'Save as template', label: 'Template name', initial: title, confirmLabel: 'Save template',
    onSubmit: async (name) => {
      try { await flushCurrent.fn?.(); await api.createTemplate(name, pageId); useUi.getState().toast(`Template “${name}” saved`); } catch (e) { useUi.getState().toast((e as Error).message, 'error'); }
    },
  });
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="pop" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''}`} aria-label="Page actions" aria-haspopup="menu" aria-expanded={open} title="More" onClick={() => setOpen((o) => !o)}><MoreHorizontal className="ic" /></button>
      {open && (
        <div className="menu" style={{ position: 'absolute', right: 0, top: 34 }} role="menu">
          <button role="menuitem" onClick={run(() => useUi.getState().setHistoryFor(pageId))}><History className="ic" />Version history<kbd>{ALT}H</kbd></button>
          <button role="menuitem" onClick={run(() => void duplicate(pageId))}><Copy className="ic" />Duplicate</button>
          <button role="menuitem" onClick={run(() => openMove('page', pageId))}><FolderInput className="ic" />Move to…</button>
          <button role="menuitem" onClick={run(saveAsTemplate)}><LayoutTemplate className="ic" />Save as template…</button>
          <hr />
          <div className="pop-label" style={{ padding: '4px 10px' }}>Export</div>
          <button role="menuitem" onClick={run(() => void exportAs('md'))}><FileText className="ic" />Markdown (.md)</button>
          <button role="menuitem" onClick={run(() => void exportAs('html'))}><FileCode2 className="ic" />HTML (.html)</button>
          <button role="menuitem" onClick={run(() => void exportAs('pdf'))}><FileDown className="ic" />PDF (print…)</button>
          <hr />
          <button role="menuitem" className="danger" onClick={run(() => requestDelete('page', pageId))}><Trash2 className="ic" />Delete…</button>
        </div>
      )}
    </div>
  );
}

function PageEditor({ page, onReload }: { page: PageDetail; onReload: () => void }) {
  const draft = useRef(readDraft(page.id, page.version)).current;
  const [title, setTitle] = useState(draft?.title ?? page.title);
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [contentError, setContentError] = useState(false);
  const linkRef = useRef<() => void>(() => {});
  const shortcuts = useRef(Extension.create({ name: 'appShortcuts', addKeyboardShortcuts: () => ({ 'Mod-Shift-k': () => { linkRef.current(); return true; } }) })).current;
  const [attVersion, setAttVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const isFav = useTree((s) => s.favorites.includes(page.id));
  const setPageTitleLocal = useTree((s) => s.setPageTitleLocal);
  const toast = useUi((s) => s.toast);

  // A rename done elsewhere (sidebar, context menu) must show up in the title field.
  const treeTitle = useTree((s) => s.pages.find((p) => p.id === page.id)?.title);
  useEffect(() => {
    if (treeTitle !== undefined && treeTitle !== title.trim() && document.activeElement?.getAttribute('aria-label') !== 'Page title') setTitle(treeTitle);
  }, [treeTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  const autosave = useAutosave(page.id, page.version, ({ title: t }) => setPageTitleLocal(page.id, t), !!draft);

  /** Uploads files, then inserts images inline and other files as links. */
  const uploadFiles = useCallback(async (files: File[], pos?: number) => {
    for (const f of files) {
      setUploading((n) => n + 1);
      try {
        const att = await api.uploadAttachment(page.id, f);
        const ed = editorRef.current;
        if (ed) {
          const node = INLINE_IMAGE.test(att.mime)
            ? { type: 'image', attrs: { src: att.url, alt: att.filename } }
            : { type: 'paragraph', content: [{ type: 'text', text: att.filename, marks: [{ type: 'link', attrs: { href: att.url } }] }] };
          const chain = ed.chain().focus();
          (pos !== undefined ? chain.insertContentAt(pos, node) : chain.insertContent(node)).run();
        }
        setAttVersion((v) => v + 1);
      } catch (e) {
        toast(`Upload of “${f.name}” failed: ${(e as Error).message}`, 'error');
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }, [page.id, toast]);
  const uploadRef = useRef(uploadFiles);
  uploadRef.current = uploadFiles;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
      Underline, TextStyle, Color, FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      LinkExt.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow' } }),
      Table.configure({ resizable: true }), TableRow, ColorHeader, ColorCell,
      TaskList, TaskItem.configure({ nested: true }),
      ResizableImage.configure({ inline: false }),
      CodeBlockLowlight.configure({ lowlight }),
      Callout, Expand, ExpandTitle, ExpandBody,
      Placeholder.configure({ placeholder: 'Start writing…' }),
      TrailingParagraph, shortcuts,
    ],
    content: JSON.parse(draft?.contentJson ?? page.contentJson),
    enableContentCheck: true,
    // Content the editor cannot represent must never be silently replaced by an empty page on the next autosave.
    onContentError: ({ editor: ed }) => { setContentError(true); ed.setEditable(false); },
    editorProps: {
      attributes: { 'aria-label': 'Page content' },
      handlePaste: (_v, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        void uploadRef.current(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (moved || !files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos;
        void uploadRef.current(files, pos);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => autosave.schedule({ contentJson: JSON.stringify(ed.getJSON()) }),
  });
  editorRef.current = editor;
  linkRef.current = () => setLinkOpen(true);

  useEffect(() => { if (draft) toast('Recovered unsaved changes from your last session'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onTitle = (v: string) => {
    setTitle(v);
    if (v.trim()) { setPageTitleLocal(page.id, v.trim()); autosave.schedule({ title: v.trim() }); }
  };

  const applyLink = (url: string | null) => {
    if (!editor) return;
    const chain = editor.chain().focus().extendMarkRange('link');
    if (url) chain.setLink({ href: /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}` }).run();
    else chain.unsetLink().run();
    setLinkOpen(false);
  };

  const insertImage = (a: AttachmentInfo) => editor?.chain().focus().insertContent({ type: 'image', attrs: { src: a.url, alt: a.filename } }).run();

  return (
    <>
      <div className="page-head">
        <Breadcrumbs kind="page" id={page.id} />
        <div className="head-row">
          <SaveStatus state={autosave.state} message={autosave.message} onRetry={() => void autosave.flush()} />
          {uploading > 0 && <span className="status saving"><span className="dot" />Uploading {uploading}…</span>}
          <button className="icon-btn" aria-label="Version history" title={`Version history (${ALT}H)`} onClick={() => useUi.getState().setHistoryFor(page.id)}><History className="ic" /></button>
          <AttachmentsPanel pageId={page.id} refreshKey={attVersion} onUpload={() => fileInput.current?.click()} onInsertImage={insertImage} onChanged={() => setAttVersion((v) => v + 1)} />
          <button className={`icon-btn ${isFav ? 'on' : ''}`} aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'} title="Favorite" onClick={() => void useTree.getState().toggleFavorite(page.id)}>
            <Star className="ic" fill={isFav ? 'currentColor' : 'none'} />
          </button>
          <PageMenu pageId={page.id} />
        </div>
        {autosave.state === 'conflict' && (
          <div role="alert" style={{ margin: '0 40px 8px', padding: '10px 14px', borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
            <span style={{ flex: 1 }}>{autosave.message} Your edits are kept here and have not been saved.</span>
            <button className="btn sm ghost" onClick={() => { clearDraft(page.id); onReload(); }}>Load latest (discard my edits)</button>
            <button className="btn sm primary" onClick={() => void autosave.overwrite()}>Overwrite with my version</button>
          </div>
        )}
        {contentError && (
          <div role="alert" style={{ margin: '0 40px 8px', padding: '10px 14px', borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 13 }}>
            This page contains content the editor cannot display, so it is locked to protect it. Nothing has been changed or deleted — restore a backup or contact support to recover it.
          </div>
        )}
        {editor && <EditorToolbar editor={editor} onLink={() => setLinkOpen(true)} onImage={() => fileInput.current?.click()} />}
      </div>
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) void uploadFiles(f); }} />
      <div className="doc">
        <input
          className="title" value={title} placeholder="Untitled page" aria-label="Page title" maxLength={200}
          onChange={(e) => onTitle(e.target.value)}
          onBlur={() => { if (!title.trim()) onTitle('Untitled page'); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus('start'); } }}
        />
        <div className="meta"><span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Clock className="ic" style={{ width: 12, height: 12 }} />Updated {new Date(page.updatedAt).toLocaleString()}</span></div>
        <EditorContent editor={editor} />
      </div>
      {linkOpen && editor && <LinkDialog initial={editor.getAttributes('link').href ?? ''} onApply={applyLink} onClose={() => setLinkOpen(false)} />}
    </>
  );
}

export default function PageView() {
  const { id = '' } = useParams();
  const [page, setPage] = useState<PageDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const touchRecent = useTree((s) => s.touchRecent);
  const reloadNonce = useUi((s) => s.reloadNonce);

  useEffect(() => {
    let alive = true;
    setPage(null); setError(null);
    api.getPage(id).then((p) => { if (alive) { setPage(p); touchRecent(p.id); } }).catch((e) => alive && setError(e as ApiError));
    return () => { alive = false; };
  }, [id, nonce, reloadNonce, touchRecent]);

  if (error) {
    return (
      <div className="center-msg"><div>
        <h2 style={{ fontSize: 18, color: 'var(--text)', marginBottom: 6 }}>{error.status === 404 ? 'This page no longer exists' : 'Could not load this page'}</h2>
        <p style={{ marginBottom: 12 }}>{error.message}</p>
        {error.status === 404 ? <Link className="link-btn" to="/">Go to workspace home</Link> : <button className="link-btn" onClick={() => setNonce((n) => n + 1)}>Try again</button>}
      </div></div>
    );
  }
  if (!page) return <div className="center-msg">Loading…</div>;
  return <PageEditor key={`${page.id}:${nonce}:${reloadNonce}`} page={page} onReload={() => setNonce((n) => n + 1)} />;
}
