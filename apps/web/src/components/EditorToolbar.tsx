import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Braces, ChevronDown, ChevronRight, Code, Highlighter, ImageIcon, Info, Italic, Link2, List,
  ListChecks, ListOrdered, Minus, Palette, Plus, Quote, Redo2, Strikethrough, Table, Underline, Undo2,
} from 'lucide-react';
import { TEXT_COLORS, TINT_COLORS } from '../lib/colors';
import { CALLOUT_TYPES, type CalloutType } from '../lib/extensions';
import ColorPanel from './ColorPanel';

function Btn({ label, on, onClick, disabled, children, cls = '' }: { label: string; on?: boolean; onClick: () => void; disabled?: boolean; children: ReactNode; cls?: string }) {
  return (
    <button type="button" className={`tb ${on ? 'on' : ''} ${cls}`} title={label} aria-label={label} aria-pressed={on} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

/** Button that opens a small floating panel; closes on outside click or Escape. */
function Pop({ label, icon, on, children, wide }: { label: string; icon: ReactNode; on?: boolean; children: (close: () => void) => ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="pop" ref={ref}>
      <button type="button" className={`tb wide ${on ? 'on' : ''}`} title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        {icon}<ChevronDown className="ic" style={{ width: 11, height: 11 }} />
      </button>
      {open && <div className={`pop-panel ${wide ? 'wide' : ''}`} role="menu" onMouseDown={(e) => e.preventDefault()}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

const SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '32px'];
const LANGS: [string, string][] = [['', 'Auto / plain'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['python', 'Python'], ['bash', 'Bash'], ['sql', 'SQL'], ['json', 'JSON'], ['xml', 'HTML / XML'], ['css', 'CSS'], ['java', 'Java'], ['go', 'Go'], ['rust', 'Rust'], ['yaml', 'YAML'], ['markdown', 'Markdown'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['php', 'PHP'], ['ruby', 'Ruby'], ['diff', 'Diff']];

export default function EditorToolbar({ editor, onLink, onImage }: { editor: Editor; onLink: () => void; onImage: () => void }) {
  const c = () => editor.chain().focus();
  const inTable = editor.isActive('table');
  const inCode = editor.isActive('codeBlock');
  const inCallout = editor.isActive('callout');
  const imageSel = editor.isActive('image');
  const heading = ([1, 2, 3] as const).find((l) => editor.isActive('heading', { level: l }));
  const textStyle = editor.getAttributes('textStyle') as { color?: string; fontSize?: string };
  const insertCallout = (t: CalloutType) => c().setCallout(t).run();

  return (
    <>
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="tb-grp">
        <Btn label="Undo (⌘Z)" onClick={() => c().undo().run()} disabled={!editor.can().undo()}><Undo2 className="ic" /></Btn>
        <Btn label="Redo (⇧⌘Z)" onClick={() => c().redo().run()} disabled={!editor.can().redo()}><Redo2 className="ic" /></Btn>
      </div>
      <div className="tb-grp">
        <select className="tb-select" aria-label="Text style" value={heading ?? 0}
          onChange={(e) => { const v = Number(e.target.value); if (v === 0) c().setParagraph().run(); else c().setHeading({ level: v as 1 | 2 | 3 }).run(); }}>
          <option value={0}>Normal text</option><option value={1}>Heading 1</option><option value={2}>Heading 2</option><option value={3}>Heading 3</option>
        </select>
        <select className="tb-select narrow" aria-label="Font size" value={textStyle.fontSize ?? ''}
          onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}>
          <option value="">Size</option>{SIZES.map((s) => <option key={s} value={s}>{parseInt(s)}</option>)}
        </select>
      </div>
      <div className="tb-grp">
        <Btn label="Bold (⌘B)" on={editor.isActive('bold')} onClick={() => c().toggleBold().run()}><Bold className="ic" /></Btn>
        <Btn label="Italic (⌘I)" on={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}><Italic className="ic" /></Btn>
        <Btn label="Underline (⌘U)" on={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()}><Underline className="ic" /></Btn>
        <Btn label="Strikethrough" on={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}><Strikethrough className="ic" /></Btn>
        <Btn label="Inline code" on={editor.isActive('code')} onClick={() => c().toggleCode().run()}><Code className="ic" /></Btn>
      </div>
      <div className="tb-grp">
        <Pop label="Text colour" on={!!textStyle.color} icon={<span className="color-icon"><Palette className="ic" /><i style={{ background: textStyle.color ?? 'transparent' }} /></span>}>
          {(close) => <ColorPanel colors={TEXT_COLORS} current={textStyle.color} resetLabel="Default colour" onPick={(col) => { (col ? c().setColor(col) : c().unsetColor()).run(); close(); }} />}
        </Pop>
        <Pop label="Highlight" on={editor.isActive('highlight')} icon={<Highlighter className="ic" />}>
          {(close) => <ColorPanel colors={TINT_COLORS.slice(4)} current={editor.getAttributes('highlight').color} resetLabel="Remove highlight" onPick={(col) => { (col ? c().setHighlight({ color: col }) : c().unsetHighlight()).run(); close(); }} />}
        </Pop>
        <Pop label="Alignment" icon={editor.isActive({ textAlign: 'center' }) ? <AlignCenter className="ic" /> : editor.isActive({ textAlign: 'right' }) ? <AlignRight className="ic" /> : editor.isActive({ textAlign: 'justify' }) ? <AlignJustify className="ic" /> : <AlignLeft className="ic" />}>
          {(close) => (
            <div className="pop-row">
              {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify]] as const).map(([a, Icon]) => (
                <button key={a} type="button" className={`tb ${editor.isActive({ textAlign: a }) ? 'on' : ''}`} aria-label={`Align ${a}`} title={`Align ${a}`} onClick={() => { c().setTextAlign(a).run(); close(); }}><Icon className="ic" /></button>
              ))}
            </div>
          )}
        </Pop>
      </div>
      <div className="tb-grp">
        <Btn label="Bullet list" on={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}><List className="ic" /></Btn>
        <Btn label="Numbered list" on={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}><ListOrdered className="ic" /></Btn>
        <Btn label="Task list" on={editor.isActive('taskList')} onClick={() => c().toggleTaskList().run()}><ListChecks className="ic" /></Btn>
      </div>
      <div className="tb-grp">
        <Btn label="Link" on={editor.isActive('link')} onClick={onLink}><Link2 className="ic" /></Btn>
        <Pop label="Insert" wide icon={<span className="ins"><Plus className="ic" />Insert</span>}>
          {(close) => {
            const item = (label: string, icon: ReactNode, fn: () => void, disabled = false) => (
              <button type="button" className="pop-item" disabled={disabled} onClick={() => { fn(); close(); }}>{icon}{label}</button>
            );
            return (
              <>
                {item('Table', <Table className="ic" />, () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), inTable)}
                {item('Image or file…', <ImageIcon className="ic" />, onImage)}
                {item('Code block', <Braces className="ic" />, () => c().toggleCodeBlock().run())}
                {item('Expandable section', <ChevronRight className="ic" />, () => c().insertExpand().run())}
                {item('Quote', <Quote className="ic" />, () => c().toggleBlockquote().run())}
                {item('Divider', <Minus className="ic" />, () => c().setHorizontalRule().run())}
                <div className="pop-label">Callout panel</div>
                {CALLOUT_TYPES.map((t) => item(t.label, <Info className="ic" />, () => insertCallout(t.type)))}
              </>
            );
          }}
        </Pop>
      </div>

    </div>
    <div className="toolbar-ctx" role="toolbar" aria-label="Context tools">
      {inCode && (
        <div className="tb-grp ctx" aria-label="Code block tools">
          <select className="tb-select" aria-label="Code language" value={(editor.getAttributes('codeBlock').language as string | null) ?? ''}
            onChange={(e) => editor.chain().focus().updateAttributes('codeBlock', { language: e.target.value || null }).run()}>
            {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      )}
      {inCallout && (
        <div className="tb-grp ctx" aria-label="Callout tools">
          {CALLOUT_TYPES.map((t) => (
            <Btn key={t.type} label={`${t.label} panel`} cls="txt" on={editor.isActive('callout', { type: t.type })} onClick={() => c().setCalloutType(t.type).run()}>{t.label}</Btn>
          ))}
          <Btn label="Remove callout" cls="txt danger" onClick={() => c().lift('callout').run()}>Unwrap</Btn>
        </div>
      )}
      {imageSel && (
        <div className="tb-grp ctx" aria-label="Image tools">
          {(['25%', '50%', '75%', '100%'] as const).map((w) => (
            <Btn key={w} label={`Image width ${w}`} cls="txt" on={editor.getAttributes('image').width === w} onClick={() => c().updateAttributes('image', { width: w }).run()}>{w}</Btn>
          ))}
          <Btn label="Delete image" cls="txt danger" onClick={() => c().deleteSelection().run()}>Remove</Btn>
        </div>
      )}
      {inTable && (
        <div className="tb-grp ctx" aria-label="Table tools">
          <Btn label="Add row above" cls="txt" onClick={() => c().addRowBefore().run()}>Row ↑</Btn>
          <Btn label="Add row below" cls="txt" onClick={() => c().addRowAfter().run()}>Row ↓</Btn>
          <Btn label="Add column left" cls="txt" onClick={() => c().addColumnBefore().run()}>Col ←</Btn>
          <Btn label="Add column right" cls="txt" onClick={() => c().addColumnAfter().run()}>Col →</Btn>
          <Btn label="Delete row" cls="txt" onClick={() => c().deleteRow().run()} disabled={!editor.can().deleteRow()}>− Row</Btn>
          <Btn label="Delete column" cls="txt" onClick={() => c().deleteColumn().run()} disabled={!editor.can().deleteColumn()}>− Col</Btn>
          <Btn label="Merge cells" cls="txt" onClick={() => c().mergeCells().run()} disabled={!editor.can().mergeCells()}>Merge</Btn>
          <Btn label="Split cell" cls="txt" onClick={() => c().splitCell().run()} disabled={!editor.can().splitCell()}>Split</Btn>
          <Btn label="Toggle header row" cls="txt" onClick={() => c().toggleHeaderRow().run()}>Header row</Btn>
          <Btn label="Toggle header column" cls="txt" onClick={() => c().toggleHeaderColumn().run()}>Header col</Btn>
          <Pop label="Cell colour" icon={<span className="ins">Cell colour</span>}>
            {(close) => <ColorPanel colors={TINT_COLORS} current={editor.getAttributes('tableCell').backgroundColor ?? editor.getAttributes('tableHeader').backgroundColor} resetLabel="No colour" onPick={(col) => { c().setCellAttribute('backgroundColor', col).run(); close(); }} />}
          </Pop>
          <Btn label="Delete table" cls="txt danger" onClick={() => c().deleteTable().run()}>Delete table</Btn>
        </div>
      )}
      {!inCode && !inCallout && !imageSel && !inTable && <span className="ctx-hint">Table, image, code and callout tools appear here</span>}
    </div>
    </>
  );
}
