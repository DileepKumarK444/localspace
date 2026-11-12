import { describe, expect, it } from 'vitest';
import { docToHtml, docToMarkdown, htmlDocument, markdownToDoc, safeUrl, type DocNode } from '@localspace/shared';

const t = (text: string, marks?: DocNode['marks']): DocNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...c: DocNode[]): DocNode => ({ type: 'paragraph', content: c });
const doc = (...c: DocNode[]): DocNode => ({ type: 'doc', content: c });

const SAMPLE: DocNode = doc(
  { type: 'heading', attrs: { level: 2 }, content: [t('Plan')] },
  p(t('Some '), t('bold', [{ type: 'bold' }]), t(' and '), t('italic', [{ type: 'italic' }]), t(' and '), t('code', [{ type: 'code' }]), t(' and '), t('link', [{ type: 'link', attrs: { href: 'https://example.com' } }])),
  { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('one')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('nested'))] }] }] }, { type: 'listItem', content: [p(t('two'))] }] },
  { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [p(t('first'))] }, { type: 'listItem', content: [p(t('second'))] }] },
  { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('done'))] }, { type: 'taskItem', attrs: { checked: false }, content: [p(t('todo'))] }] },
  { type: 'blockquote', content: [p(t('quoted'))] },
  { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1;\nconsole.log(a);')] },
  { type: 'callout', attrs: { type: 'warning' }, content: [p(t('careful'))] },
  { type: 'horizontalRule' },
  { type: 'table', content: [
    { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('A'))] }, { type: 'tableHeader', content: [p(t('B'))] }] },
    { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('1'))] }, { type: 'tableCell', content: [p(t('x | y'))] }] },
  ] },
);

describe('HTML export', () => {
  it('renders the supported node types', () => {
    const html = docToHtml(SAMPLE);
    for (const frag of ['<h2>Plan</h2>', '<strong>bold</strong>', '<em>italic</em>', '<code>code</code>', '<a href="https://example.com"', '<ul><li><p>one</p><ul>', '<ol>', 'type="checkbox" disabled checked', '<blockquote>', 'class="language-ts"', 'callout callout-warning', '<hr>', '<th><p>A</p></th>']) {
      expect(html).toContain(frag);
    }
  });

  it('escapes text and blocks script/URL/style injection', () => {
    const evil = doc(
      p(t('<script>alert(1)</script>"&')),
      p(t('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])),
      p(t('y', [{ type: 'link', attrs: { href: 'https://ok.com/" onmouseover="alert(1)' } }])),
      p(t('z', [{ type: 'textStyle', attrs: { color: 'red;background:url(javascript:alert(1))', fontSize: '20px' } }])),
      { type: 'image', attrs: { src: 'javascript:alert(1)', alt: '"><script>' } },
      { type: 'image', attrs: { src: 'https://img.test/a.png', alt: '"><script>x</script>' } },
      { type: 'codeBlock', attrs: { language: '"><script>' }, content: [t('</code><script>1</script>')] },
    );
    const html = docToHtml(evil);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onmouseover="alert');
    expect(html).not.toContain('url(');
    expect(html).toContain('font-size:20px');
    expect(htmlDocument('<b>T</b>', evil)).toContain('&lt;b&gt;T&lt;/b&gt;');
  });

  it('can rewrite or drop images and adds a print script only in print mode', () => {
    const d = doc({ type: 'image', attrs: { src: '/api/attachments/abc/file', alt: 'a' } });
    expect(docToHtml(d, { imageSrc: () => 'data:image/png;base64,AAA' })).toContain('data:image/png;base64,AAA');
    expect(docToHtml(d, { imageSrc: () => null })).toBe('');
    expect(htmlDocument('T', d)).not.toContain('window.print');
    expect(htmlDocument('T', d, { print: true })).toContain('window.print');
  });

  it('safeUrl allow-list', () => {
    expect(safeUrl('https://a.b')).toBe('https://a.b');
    expect(safeUrl('/api/x')).toBe('/api/x');
    for (const bad of ['javascript:1', 'JaVaScRiPt:1', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x', '']) expect(safeUrl(bad)).toBeNull();
  });
});

describe('Markdown export', () => {
  const md = docToMarkdown(SAMPLE);
  it('produces GitHub-flavoured Markdown', () => {
    expect(md).toContain('## Plan');
    expect(md).toContain('Some **bold** and _italic_ and `code` and [link](https://example.com)');
    expect(md).toContain('- one\n  - nested\n- two');
    expect(md).toContain('1. first\n2. second');
    expect(md).toContain('- [x] done\n- [ ] todo');
    expect(md).toContain('> quoted');
    expect(md).toContain('```ts\nconst a = 1;\nconsole.log(a);\n```');
    expect(md).toContain('> [!WARNING]\n> careful');
    expect(md).toContain('---');
    expect(md).toContain('| A | B |\n| --- | --- |\n| 1 | x \\| y |');
  });
  it('escapes markdown syntax in plain text and uses safer fences', () => {
    expect(docToMarkdown(doc(p(t('2 * 3 = 6 and _x_ [y]'))))).toBe('2 \\* 3 = 6 and \\_x\\_ \\[y\\]\n');
    expect(docToMarkdown(doc({ type: 'codeBlock', content: [t('```\nx\n```')] }))).toContain('~~~');
  });
});

describe('Markdown import', () => {
  it('uses a leading H1 as the title and converts block types', () => {
    const { title, doc: d } = markdownToDoc('# My Page\n\nIntro with **bold**, _em_, `code`, ~~gone~~ and [a link](https://x.io).\n\n## Lists\n\n- a\n  - b\n- c\n\n1. one\n2. two\n\n- [x] done\n- [ ] todo\n\n> quote\n\n```js\nlet x = 1;\n```\n\n---\n\n| H1 | H2 |\n|----|----|\n| a  | b  |\n');
    expect(title).toBe('My Page');
    const types = d.content!.map((n) => n.type);
    expect(types).toEqual(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'horizontalRule', 'table']);
    const marks = d.content![0].content!.flatMap((n) => (n.marks ?? []).map((m) => m.type));
    expect(marks).toEqual(expect.arrayContaining(['bold', 'italic', 'code', 'strike', 'link']));
    expect(d.content![5]).toMatchObject({ type: 'blockquote' });
    expect(d.content![6].attrs).toMatchObject({ language: 'js' });
    expect(d.content![4].content![0].attrs).toMatchObject({ checked: true });
    expect(d.content![8].content![0].content![0].type).toBe('tableHeader');
    // list items always start with a paragraph (TipTap schema)
    expect(d.content![2].content![0].content![0].type).toBe('paragraph');
  });

  it('maps GitHub alerts to callouts', () => {
    const { doc: d } = markdownToDoc('> [!NOTE]\n> Remember this\n\n> [!WARNING]\n> Careful\n');
    expect(d.content!.map((n) => [n.type, n.attrs?.type])).toEqual([['callout', 'note'], ['callout', 'warning']]);
    expect(JSON.stringify(d.content![0])).not.toContain('[!NOTE]');
  });

  it('never produces empty text nodes, deep headings, or unsafe links/images', () => {
    const { doc: d } = markdownToDoc('###### deep\n\n[bad](javascript:alert(1)) ![local](./pic.png) ![ok](https://i.test/a.png) <u>under</u> <script>alert(1)</script>\n\n-\n');
    const bad: string[] = [];
    const walk = (n: DocNode) => { if (n.type === 'text' && !n.text) bad.push('empty'); n.content?.forEach(walk); };
    walk(d);
    expect(bad).toEqual([]);
    const s = JSON.stringify(d);
    expect(s).not.toContain('javascript:');
    expect(d.content![0].attrs).toMatchObject({ level: 3 });
    expect(s).toContain('[image: local]');
    expect(d.content!.some((n) => n.type === 'image')).toBe(true);
    expect(s).toContain('"underline"');
  });

  it('round-trips through Markdown without losing structure', () => {
    const again = markdownToDoc(docToMarkdown(SAMPLE)).doc;
    const shape = (n: DocNode): string => n.type + (n.content ? `(${n.content.map(shape).join(',')})` : '');
    // heading level, lists, tasks, quote, code, callout, rule and table survive
    const types = again.content!.map((n) => n.type);
    expect(types).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'callout', 'horizontalRule', 'table']);
    expect(shape(again.content![2])).toBe(shape(SAMPLE.content![2]));
    expect(again.content![6].content![0].text).toBe('const a = 1;\nconsole.log(a);');
    expect(JSON.stringify(again.content![9])).toContain('x | y');
  });

  it('handles empty and weird input', () => {
    expect(markdownToDoc('').doc.content).toEqual([{ type: 'paragraph' }]);
    expect(markdownToDoc('\r\n\r\n').doc.content!.length).toBe(1);
    expect(markdownToDoc('# Only title').doc.content).toEqual([{ type: 'paragraph' }]);
  });
});
