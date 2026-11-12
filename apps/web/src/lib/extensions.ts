import { Extension, Node, mergeAttributes } from '@tiptap/react';
import Image from '@tiptap/extension-image';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import { common, createLowlight } from 'lowlight';

export const lowlight = createLowlight(common);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: { setFontSize: (size: string) => ReturnType; unsetFontSize: () => ReturnType };
    callout: { setCallout: (type: CalloutType) => ReturnType; setCalloutType: (type: CalloutType) => ReturnType };
    expand: { insertExpand: () => ReturnType };
  }
}

/** Font size as an attribute of the textStyle mark (so it combines with text colour). */
export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => (el as HTMLElement).style.fontSize || null,
          renderHTML: (a) => (a.fontSize ? { style: `font-size: ${a.fontSize}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

/** Images with a width preset (25% / 50% / 75% / 100%). */
export const ResizableImage = Image.extend({
  /** Clicking an image must select it (so the size tools appear); ProseMirror's Chrome click handling otherwise drops to a text cursor. */
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClickOn: (view, _pos, node, nodePos) => {
            if (node.type.name !== 'image') return false;
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)));
            return true;
          },
        },
        // After the click Chrome reports its own collapsed selection at the image edge, which ProseMirror would apply as a
        // text cursor and so deselect the image. Keep the image selected when that pointer event lands on the same spot.
        appendTransaction: (trs, oldState, newState) => {
          const old = oldState.selection;
          if (!(old instanceof NodeSelection) || old.node.type.name !== 'image') return null;
          if (!trs.some((t) => t.getMeta('pointer') && !t.docChanged)) return null;
          const cur = newState.selection;
          if (cur instanceof NodeSelection || !cur.empty || (cur.from !== old.from && cur.from !== old.to)) return null;
          return newState.tr.setSelection(NodeSelection.create(newState.doc, old.from));
        },
      }),
    ];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-width'),
        renderHTML: (a) => (a.width ? { 'data-width': a.width, style: `width: ${a.width}` } : {}),
      },
    };
  },
});

const cellBackground = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-bg'),
    renderHTML: (a: { backgroundColor?: string | null }) => (a.backgroundColor ? { 'data-bg': a.backgroundColor, style: `background-color: ${a.backgroundColor}` } : {}),
  },
};
export const ColorCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellBackground }; } });
export const ColorHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellBackground }; } });

export type CalloutType = 'info' | 'note' | 'warning' | 'error';
export const CALLOUT_TYPES: { type: CalloutType; label: string }[] = [
  { type: 'info', label: 'Info' }, { type: 'note', label: 'Note' }, { type: 'warning', label: 'Warning' }, { type: 'error', label: 'Error' },
];

/** Coloured panel that can hold any blocks. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { type: { default: 'info', parseHTML: (el) => el.getAttribute('data-callout') ?? 'info', renderHTML: (a) => ({ 'data-callout': a.type }) } };
  },
  parseHTML() { return [{ tag: 'div[data-callout]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ class: 'callout' }, HTMLAttributes), 0]; },
  addCommands() {
    return {
      setCallout: (type) => ({ commands }) => commands.wrapIn(this.name, { type }),
      setCalloutType: (type) => ({ commands }) => commands.updateAttributes(this.name, { type }),
    };
  },
});

export const ExpandTitle = Node.create({
  name: 'expandTitle',
  content: 'inline*',
  defining: true,
  selectable: false,
  parseHTML() { return [{ tag: 'div[data-expand-title]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ 'data-expand-title': '', class: 'expand-title' }, HTMLAttributes), 0]; },
});
export const ExpandBody = Node.create({
  name: 'expandBody',
  content: 'block+',
  defining: true,
  selectable: false,
  parseHTML() { return [{ tag: 'div[data-expand-body]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ 'data-expand-body': '', class: 'expand-body' }, HTMLAttributes), 0]; },
});

/** Collapsible section: an always-visible title row and a body that can be folded away. */
export const Expand = Node.create({
  name: 'expand',
  group: 'block',
  content: 'expandTitle expandBody',
  defining: true,
  isolating: true,
  addAttributes() {
    return { open: { default: true, parseHTML: (el) => el.getAttribute('data-open') !== 'false', renderHTML: (a) => ({ 'data-open': String(a.open) }) } };
  },
  parseHTML() { return [{ tag: 'div[data-expand]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ 'data-expand': '', class: 'expand' }, HTMLAttributes), 0]; },
  addCommands() {
    return {
      insertExpand: () => ({ commands }) =>
        commands.insertContent({
          type: 'expand', attrs: { open: true },
          content: [{ type: 'expandTitle', content: [{ type: 'text', text: 'Section title' }] }, { type: 'expandBody', content: [{ type: 'paragraph' }] }],
        }),
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'expand';
      dom.setAttribute('data-expand', '');
      dom.dataset.open = String(node.attrs.open);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'expand-toggle';
      toggle.contentEditable = 'false';
      toggle.setAttribute('aria-label', 'Expand or collapse section');
      toggle.onclick = () => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, open: !current.attrs.open }));
      };
      const contentDOM = document.createElement('div');
      contentDOM.className = 'expand-content';
      dom.append(toggle, contentDOM);
      return {
        dom,
        contentDOM,
        update: (n) => {
          if (n.type !== current.type) return false;
          current = n;
          dom.dataset.open = String(n.attrs.open);
          return true;
        },
        stopEvent: (e) => e.target === toggle,
        ignoreMutation: (m) => m.type === 'attributes' && m.target === dom,
      };
    };
  },
});
