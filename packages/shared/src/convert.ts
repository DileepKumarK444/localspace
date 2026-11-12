/**
 * Pure converters between the TipTap document JSON and Markdown / HTML.
 * No DOM or Node APIs, so they run (and are tested) anywhere. All HTML output is built by escaping every
 * text and attribute value, and URLs/styles are allow-listed, so rendered documents cannot inject script.
 */
import { marked, type Token, type Tokens } from 'marked';

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/* ------------------------------------------------------------------ helpers */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Only http(s), mailto, tel and relative/absolute-path URLs survive. */
export function safeUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!u) return null;
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null; // any other scheme (javascript:, data:, file: …)
  return u;
}
const safeColor = (c: unknown) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\))$/i.test(c.trim()) ? c.trim() : null);
const safeSize = (s: unknown) => (typeof s === 'string' && /^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/.test(s.trim()) ? s.trim() : null);
const kids = (n: DocNode) => n.content ?? [];
const plain = (n: DocNode): string => (n.text ?? '') + kids(n).map(plain).join(n.type === 'paragraph' || n.type === 'heading' ? '' : '\n');

/* ------------------------------------------------------------------ HTML */

export interface HtmlOptions {
  /** Rewrites image sources (e.g. to embed attachments as data URIs). Return null to drop the image. */
  imageSrc?: (src: string) => string | null;
}

function renderMarks(text: string, marks: DocNode['marks']): string {
  let out = esc(text);
  const style: string[] = [];
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'bold': out = `<strong>${out}</strong>`; break;
      case 'italic': out = `<em>${out}</em>`; break;
      case 'underline': out = `<u>${out}</u>`; break;
      case 'strike': out = `<s>${out}</s>`; break;
      case 'code': out = `<code>${out}</code>`; break;
      case 'link': { const href = safeUrl(m.attrs?.href); if (href) out = `<a href="${esc(href)}" rel="noopener noreferrer nofollow">${out}</a>`; break; }
      case 'highlight': { const c = safeColor(m.attrs?.color); out = `<mark${c ? ` style="background-color:${c}"` : ''}>${out}</mark>`; break; }
      case 'textStyle': {
        const c = safeColor(m.attrs?.color);
        const s = safeSize(m.attrs?.fontSize);
        if (c) style.push(`color:${c}`);
        if (s) style.push(`font-size:${s}`);
        break;
      }
    }
  }
  return style.length ? `<span style="${style.join(';')}">${out}</span>` : out;
}

const alignStyle = (n: DocNode) => (['left', 'center', 'right', 'justify'].includes(n.attrs?.textAlign as string) && n.attrs?.textAlign !== 'left' ? ` style="text-align:${n.attrs?.textAlign}"` : '');

function renderNode(n: DocNode, o: HtmlOptions): string {
  const inner = () => kids(n).map((c) => renderNode(c, o)).join('');
  switch (n.type) {
    case 'doc': return inner();
    case 'text': return renderMarks(n.text ?? '', n.marks);
    case 'hardBreak': return '<br>';
    case 'paragraph': return `<p${alignStyle(n)}>${inner()}</p>`;
    case 'heading': { const l = Math.min(6, Math.max(1, Number(n.attrs?.level) || 1)); return `<h${l}${alignStyle(n)}>${inner()}</h${l}>`; }
    case 'bulletList': return `<ul>${inner()}</ul>`;
    case 'orderedList': { const s = Number(n.attrs?.start) || 1; return `<ol${s !== 1 ? ` start="${s}"` : ''}>${inner()}</ol>`; }
    case 'listItem': return `<li>${inner()}</li>`;
    case 'taskList': return `<ul class="task-list">${inner()}</ul>`;
    case 'taskItem': return `<li class="task"><input type="checkbox" disabled${n.attrs?.checked ? ' checked' : ''}> <div>${inner()}</div></li>`;
    case 'blockquote': return `<blockquote>${inner()}</blockquote>`;
    case 'codeBlock': {
      const lang = typeof n.attrs?.language === 'string' && /^[\w+#-]{1,20}$/.test(n.attrs.language) ? n.attrs.language : null;
      return `<pre><code${lang ? ` class="language-${lang}"` : ''}>${esc(plain(n))}</code></pre>`;
    }
    case 'horizontalRule': return '<hr>';
    case 'table': return `<table><tbody>${inner()}</tbody></table>`;
    case 'tableRow': return `<tr>${inner()}</tr>`;
    case 'tableHeader':
    case 'tableCell': {
      const tag = n.type === 'tableHeader' ? 'th' : 'td';
      const cs = Number(n.attrs?.colspan) || 1, rs = Number(n.attrs?.rowspan) || 1;
      const bg = safeColor(n.attrs?.backgroundColor);
      return `<${tag}${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}${bg ? ` style="background-color:${bg}"` : ''}>${inner()}</${tag}>`;
    }
    case 'image': {
      const raw = safeUrl(n.attrs?.src);
      const src = raw && (o.imageSrc ? o.imageSrc(raw) : raw);
      if (!src) return '';
      const w = typeof n.attrs?.width === 'string' && /^\d{1,3}%$/.test(n.attrs.width) ? ` style="width:${n.attrs.width}"` : '';
      return `<img src="${esc(src)}" alt="${esc(String(n.attrs?.alt ?? ''))}"${w}>`;
    }
    case 'callout': {
      const t = ['info', 'note', 'warning', 'error'].includes(n.attrs?.type as string) ? (n.attrs?.type as string) : 'info';
      return `<div class="callout callout-${t}">${inner()}</div>`;
    }
    case 'expand': {
      const [title, body] = kids(n);
      return `<details${n.attrs?.open === false ? '' : ' open'}><summary>${title ? kids(title).map((c) => renderNode(c, o)).join('') : ''}</summary>${body ? kids(body).map((c) => renderNode(c, o)).join('') : ''}</details>`;
    }
    default: return inner();
  }
}

/** Renders the document body as an HTML fragment. */
export const docToHtml = (doc: DocNode, o: HtmlOptions = {}) => renderNode(doc, o);

const PAGE_CSS = `
:root{color-scheme:light}
body{font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#253858;max-width:820px;margin:40px auto;padding:0 24px}
h1.doc-title{font-size:34px;line-height:1.2;margin:0 0 24px;color:#172b4d}
h1,h2,h3{color:#172b4d;line-height:1.3}h2{margin-top:1.6em}
a{color:#0c66e4}img{max-width:100%;height:auto;border-radius:6px}
pre{background:#0f172a;color:#e2e8f0;padding:14px 16px;border-radius:8px;overflow:auto;font:13px/1.6 ui-monospace,Menlo,monospace}
code{font:0.9em ui-monospace,Menlo,monospace;background:#f1f2f4;padding:1px 5px;border-radius:4px}pre code{background:none;padding:0}
blockquote{border-left:3px solid #dcdfe4;margin:12px 0;padding:2px 16px;color:#44546f}
table{border-collapse:collapse;width:100%;margin:14px 0}th,td{border:1px solid #dcdfe4;padding:8px 12px;text-align:left;vertical-align:top}th{background:#f7f8f9}
hr{border:0;border-top:2px solid #ebecf0;margin:24px 0}mark{background:#fff0b3}
.callout{padding:12px 16px;border-radius:8px;margin:14px 0;border:1px solid #b3d4ff;background:#e9f2ff}.callout>:first-child{margin-top:0}.callout>:last-child{margin-bottom:0}
.callout-note{background:#e3fcef;border-color:#abf5d1}.callout-warning{background:#fff7d6;border-color:#f8e6a0}.callout-error{background:#ffeceb;border-color:#ffc9c5}
ul.task-list{list-style:none;padding-left:4px}li.task{display:flex;gap:8px}li.task p{margin:0}
li>p{margin:.2em 0}td>p,th>p{margin:0}.callout p{margin:.3em 0}
details{border:1px solid #dcdfe4;border-radius:8px;padding:8px 14px;margin:14px 0}summary{font-weight:600;cursor:pointer}
@media print{body{margin:0;max-width:none}pre,table,blockquote,.callout{break-inside:avoid}.no-print{display:none}}
`;

/** Standalone HTML page. `print` adds a banner and opens the browser print dialog (for "Save as PDF"). */
export function htmlDocument(title: string, doc: DocNode, o: HtmlOptions & { print?: boolean } = {}): string {
  const banner = o.print ? `<p class="no-print" style="background:#e9f2ff;padding:10px 14px;border-radius:8px;font-size:14px">In the print dialog choose <b>Save as PDF</b> as the destination.</p>` : '';
  const script = o.print ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},300)})</script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body>${banner}<h1 class="doc-title">${esc(title)}</h1>${docToHtml(doc, o)}${script}</body></html>`;
}

/* ------------------------------------------------------------------ Markdown export */

export interface MdOptions { imageSrc?: (src: string) => string | null }

const mdEscape = (s: string) => s.replace(/([\\`*_[\]<])/g, '\\$1');

function mdInline(nodes: DocNode[], o: MdOptions): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n';
      if (n.type === 'image') { const src = safeUrl(n.attrs?.src); const s = src && (o.imageSrc ? o.imageSrc(src) : src); return s ? `![${mdEscape(String(n.attrs?.alt ?? ''))}](${s})` : ''; }
      if (n.type !== 'text') return mdInline(kids(n), o);
      const marks = n.marks ?? [];
      const has = (t: string) => marks.some((m) => m.type === t);
      const lead = (n.text ?? '').match(/^\s*/)![0];
      const trail = (n.text ?? '').match(/\s*$/)![0];
      const core = (n.text ?? '').trim();
      if (!core) return n.text ?? '';
      let t = has('code') ? `\`${core.replace(/`/g, '\\`')}\`` : mdEscape(core);
      if (has('bold')) t = `**${t}**`;
      if (has('italic')) t = `_${t}_`;
      if (has('strike')) t = `~~${t}~~`;
      if (has('underline')) t = `<u>${t}</u>`;
      const link = marks.find((m) => m.type === 'link');
      const href = link && safeUrl(link.attrs?.href);
      if (href) t = `[${t}](${href.replace(/\)/g, '%29')})`;
      return lead + t + trail;
    })
    .join('');
}

function mdBlocks(nodes: DocNode[], o: MdOptions, indent = ''): string {
  const out: string[] = [];
  for (const n of nodes) {
    const s = mdBlock(n, o, indent);
    if (s !== null) out.push(s);
  }
  return out.join('\n\n');
}

const prefix = (text: string, p: string, first = p) => text.split('\n').map((l, i) => (i === 0 ? first : p) + l).join('\n');

function mdBlock(n: DocNode, o: MdOptions, indent: string): string | null {
  switch (n.type) {
    case 'paragraph': return mdInline(kids(n), o);
    case 'heading': return `${'#'.repeat(Math.min(6, Number(n.attrs?.level) || 1))} ${mdInline(kids(n), o)}`;
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const start = Number(n.attrs?.start) || 1;
      return kids(n).map((li, i) => {
        const [first, ...rest] = kids(li);
        const marker = n.type === 'orderedList' ? `${start + i}. ` : n.type === 'taskList' ? `- [${li.attrs?.checked ? 'x' : ' '}] ` : '- ';
        const head = first ? mdBlock(first, o, '') ?? '' : '';
        const tail = rest.length ? '\n' + prefix(mdBlocks(rest, o), ' '.repeat(marker.length)) : '';
        return prefix(head, ' '.repeat(marker.length), marker) + tail;
      }).join('\n');
    }
    case 'blockquote': return prefix(mdBlocks(kids(n), o), '> ');
    case 'callout': {
      const label = ({ info: 'INFO', note: 'NOTE', warning: 'WARNING', error: 'ERROR' } as Record<string, string>)[n.attrs?.type as string] ?? 'INFO';
      return prefix(`[!${label}]\n${mdBlocks(kids(n), o)}`, '> ');
    }
    case 'codeBlock': {
      const code = plain(n);
      const fence = code.includes('```') ? '~~~' : '```';
      const lang = typeof n.attrs?.language === 'string' ? n.attrs.language : '';
      return `${fence}${lang}\n${code}\n${fence}`;
    }
    case 'horizontalRule': return '---';
    case 'image': return mdInline([n], o);
    case 'table': {
      const rows = kids(n).map((r) => kids(r).map((c) => kids(c).map((b) => mdBlock(b, o, '') ?? '').join('<br>').replace(/\|/g, '\\|').replace(/\n/g, ' ')));
      if (!rows.length) return null;
      const width = Math.max(...rows.map((r) => r.length));
      const pad = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
      return [pad(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(pad)].join('\n');
    }
    case 'expand': {
      const [title, body] = kids(n);
      return `<details${n.attrs?.open === false ? '' : ' open'}>\n<summary>${esc(title ? plain(title) : '')}</summary>\n\n${body ? mdBlocks(kids(body), o) : ''}\n\n</details>`;
    }
    default: return kids(n).length ? mdBlocks(kids(n), o) : null;
  }
}

/** Serialises the document as GitHub-flavoured Markdown. Colours, font sizes and merged cells have no Markdown form and are dropped. */
export function docToMarkdown(doc: DocNode, o: MdOptions = {}): string {
  return mdBlocks(kids(doc), o).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ------------------------------------------------------------------ Markdown import */

type Mark = { type: string; attrs?: Record<string, unknown> };
const EMPTY_P: DocNode = { type: 'paragraph' };

function pushText(out: DocNode[], text: string, marks: Mark[]) {
  if (!text) return;
  const last = out[out.length - 1];
  const same = last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(marks);
  if (same) last.text += text;
  else out.push(marks.length ? { type: 'text', text, marks: [...marks] } : { type: 'text', text });
}

function inlineTokens(tokens: Token[] | undefined, marks: Mark[], out: DocNode[], st = { underline: false }) {
  for (const t of tokens ?? []) {
    const m = st.underline ? [...marks, { type: 'underline' }] : marks;
    switch (t.type) {
      case 'text': case 'escape': {
        const tt = t as Tokens.Text;
        if (tt.tokens?.length) inlineTokens(tt.tokens, m, out, st); else pushText(out, tt.text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"), m);
        break;
      }
      case 'strong': inlineTokens((t as Tokens.Strong).tokens, [...m, { type: 'bold' }], out, st); break;
      case 'em': inlineTokens((t as Tokens.Em).tokens, [...m, { type: 'italic' }], out, st); break;
      case 'del': inlineTokens((t as Tokens.Del).tokens, [...m, { type: 'strike' }], out, st); break;
      case 'codespan': pushText(out, (t as Tokens.Codespan).text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), [...m, { type: 'code' }]); break;
      case 'br': out.push({ type: 'hardBreak' }); break;
      case 'link': {
        const l = t as Tokens.Link;
        const href = safeUrl(l.href);
        inlineTokens(l.tokens, href ? [...m, { type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null } }] : m, out, st);
        break;
      }
      case 'image': {
        const im = t as Tokens.Image;
        const src = safeUrl(im.href);
        if (src && (/^https?:\/\//i.test(src) || src.startsWith('/api/attachments/'))) out.push({ type: 'image', attrs: { src, alt: im.text } });
        else pushText(out, `[image: ${im.text || im.href}]`, m);
        break;
      }
      case 'html': {
        const tag = (t as Tokens.HTML).text.trim().toLowerCase();
        if (tag === '<u>') st.underline = true; else if (tag === '</u>') st.underline = false;
        break; // all other inline HTML is dropped
      }
      default: if ('text' in t) pushText(out, String((t as { text: string }).text), m);
    }
  }
}

/** Builds paragraph block(s) from inline nodes; images cannot live inside a paragraph so they are lifted out. */
function paragraphs(inline: DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  let cur: DocNode[] = [];
  const flush = () => { if (cur.length) { out.push({ type: 'paragraph', content: cur }); cur = []; } };
  for (const n of inline) { if (n.type === 'image') { flush(); out.push(n); } else cur.push(n); }
  flush();
  return out;
}
const inlineToBlocks = (tokens: Token[] | undefined): DocNode[] => { const o: DocNode[] = []; inlineTokens(tokens, [], o); return paragraphs(o); };
const inlineOnly = (tokens: Token[] | undefined): DocNode[] => { const o: DocNode[] = []; inlineTokens(tokens, [], o); return o.filter((n) => n.type !== 'image'); };

const CALLOUT_MAP: Record<string, string> = { NOTE: 'note', TIP: 'info', INFO: 'info', IMPORTANT: 'info', WARNING: 'warning', CAUTION: 'warning', ERROR: 'error', DANGER: 'error' };

function blockTokens(tokens: Token[]): DocNode[] {
  const out: DocNode[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading;
        const content = inlineOnly(h.tokens);
        out.push({ type: 'heading', attrs: { level: Math.min(3, h.depth) }, ...(content.length ? { content } : {}) });
        break;
      }
      case 'paragraph': out.push(...inlineToBlocks((t as Tokens.Paragraph).tokens)); break;
      case 'text': out.push(...inlineToBlocks((t as Tokens.Text).tokens ?? [t])); break;
      case 'hr': out.push({ type: 'horizontalRule' }); break;
      case 'code': {
        const c = t as Tokens.Code;
        const lang = c.lang?.trim().split(/\s+/)[0];
        out.push({ type: 'codeBlock', attrs: { language: lang || null }, ...(c.text ? { content: [{ type: 'text', text: c.text }] } : {}) });
        break;
      }
      case 'blockquote': {
        const inner = blockTokens((t as Tokens.Blockquote).tokens);
        const first = inner[0];
        const head = first?.type === 'paragraph' ? plain(first).match(/^\[!(\w+)\]\s*/) : null;
        if (head && CALLOUT_MAP[head[1].toUpperCase()]) {
          const rest = JSON.parse(JSON.stringify(inner)) as DocNode[];
          const fc = rest[0].content ?? [];
          if (fc[0]?.text !== undefined) { fc[0].text = fc[0].text.replace(/^\[!\w+\]\s*/, ''); if (!fc[0].text) fc.shift(); }
          if (!fc.length) rest.shift(); else rest[0].content = fc;
          out.push({ type: 'callout', attrs: { type: CALLOUT_MAP[head[1].toUpperCase()] }, content: rest.length ? rest : [EMPTY_P] });
        } else out.push({ type: 'blockquote', content: inner.length ? inner : [EMPTY_P] });
        break;
      }
      case 'list': {
        const l = t as Tokens.List;
        const isTask = l.items.length > 0 && l.items.every((i) => i.task);
        const items = l.items.map((i) => {
          let content = blockTokens(i.tokens);
          // list items must start with a paragraph
          if (!content.length || content[0].type !== 'paragraph') content = [EMPTY_P, ...content];
          return isTask ? { type: 'taskItem', attrs: { checked: !!i.checked }, content } : { type: 'listItem', content };
        });
        out.push(isTask ? { type: 'taskList', content: items } : l.ordered ? { type: 'orderedList', attrs: { start: Number(l.start) || 1 }, content: items } : { type: 'bulletList', content: items });
        break;
      }
      case 'table': {
        const tb = t as Tokens.Table;
        const cell = (c: Tokens.TableCell, header: boolean): DocNode => {
          const content = inlineOnly(c.tokens);
          return { type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', ...(content.length ? { content } : {}) }] };
        };
        out.push({ type: 'table', content: [{ type: 'tableRow', content: tb.header.map((c) => cell(c, true)) }, ...tb.rows.map((r) => ({ type: 'tableRow', content: r.map((c) => cell(c, false)) }))] });
        break;
      }
      case 'html': {
        const text = (t as Tokens.HTML).text.replace(/<[^>]+>/g, '').trim();
        if (text) out.push({ type: 'paragraph', content: [{ type: 'text', text }] });
        break;
      }
      default: break; // space, def, etc.
    }
  }
  return out;
}

/**
 * Converts Markdown to a TipTap document. A leading level-1 heading is returned as `title` and removed from the body.
 * Anything with no equivalent (raw HTML, relative images, footnotes) degrades to plain text instead of being rejected.
 */
export function markdownToDoc(markdown: string): { title: string | null; doc: DocNode } {
  const tokens = marked.lexer(markdown.replace(/\r\n?/g, '\n'), { gfm: true, breaks: false });
  let title: string | null = null;
  const first = tokens.find((t) => t.type !== 'space');
  let body: Token[] = tokens;
  if (first?.type === 'heading' && (first as Tokens.Heading).depth === 1) {
    title = (first as Tokens.Heading).text.trim() || null;
    body = tokens.filter((t) => t !== first);
  }
  const content = blockTokens(body);
  return { title, doc: { type: 'doc', content: content.length ? content : [EMPTY_P] } };
}
