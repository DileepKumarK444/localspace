/* Tiny TipTap JSON builders used by the seed data and built-in templates. */
export type Node = Record<string, unknown>;
export type Inline = string | Node;
export const text = (t: string, marks?: Node[]): Node => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
export const bold = (t: string) => text(t, [{ type: 'bold' }]);
export const code = (t: string) => text(t, [{ type: 'code' }]);
export const link = (t: string, href: string) => text(t, [{ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null } }]);
export const inl = (x: Inline) => (typeof x === 'string' ? text(x) : x);
/** Paragraph; empty strings are dropped because TipTap rejects empty text nodes. */
export const p = (...c: Inline[]): Node => {
  const content = c.filter((x) => x !== '').map(inl);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};
export const h = (level: number, t: string): Node => ({ type: 'heading', attrs: { level }, content: [text(t)] });
export const ul = (...items: Inline[][]): Node => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(...i)] })) });
export const ol = (...items: Inline[][]): Node => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map((i) => ({ type: 'listItem', content: [p(...i)] })) });
export const codeBlock = (t: string, language: string): Node => ({ type: 'codeBlock', attrs: { language }, content: [text(t)] });
export const quote = (t: string): Node => ({ type: 'blockquote', content: [p(t)] });
export const hr: Node = { type: 'horizontalRule' };
export const table = (rows: string[][]): Node => ({
  type: 'table',
  content: rows.map((r, i) => ({
    type: 'tableRow',
    content: r.map((c) => ({ type: i === 0 ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(c)] })),
  })),
});
export const doc = (...content: Node[]) => JSON.stringify({ type: 'doc', content });

export const taskList = (...items: { text: string; checked?: boolean }[]): Node => ({
  type: 'taskList',
  content: items.map((i) => ({ type: 'taskItem', attrs: { checked: !!i.checked }, content: [p(i.text)] })),
});
export const callout = (kind: 'info' | 'note' | 'warning' | 'error', ...c: Inline[]): Node => ({ type: 'callout', attrs: { type: kind }, content: [p(...c)] });
export const expand = (title: string, ...body: Node[]): Node => ({
  type: 'expand',
  attrs: { open: true },
  content: [{ type: 'expandTitle', content: [text(title)] }, { type: 'expandBody', content: body.length ? body : [p()] }],
});
