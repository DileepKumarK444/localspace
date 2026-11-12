import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/** Keeps an empty paragraph at the end of the document so there is always somewhere to click/type after a table or code block. */
export const TrailingParagraph = Extension.create({
  name: 'trailingParagraph',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('trailingParagraph'),
        appendTransaction: (_trs, _old, state) => {
          const { doc, tr, schema } = state;
          const last = doc.lastChild;
          if (!last || last.type.name === 'paragraph') return null;
          const paragraph = schema.nodes.paragraph;
          return paragraph ? tr.insert(doc.content.size, paragraph.create()) : null;
        },
      }),
    ];
  },
});
