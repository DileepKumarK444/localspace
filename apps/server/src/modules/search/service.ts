import type { SearchResponse, SearchSort, SearchType } from '@localspace/shared';
import { getWorkspaceId, prisma } from '../../db';
import { folderPath, folderSubtree, loadMeta, pagePath, pageSubtree } from '../tree/hierarchy';

export interface ParsedQuery {
  /** FTS5 MATCH expression, or null when the query has no positive terms. */
  fts: string | null;
  /** Lower-cased positive words/phrases, used for substring (title/folder/filename) matching. */
  terms: string[];
  /** Lower-cased words that must NOT appear (`-word`). */
  exclude: string[];
}

/**
 * Query syntax: plain words (the last one also matches as a prefix), "exact phrases", and -excluded words.
 * Every token is quoted before it reaches FTS5, so user input can never be interpreted as FTS syntax.
 */
export function parseQuery(q: string): ParsedQuery {
  const positive: string[] = [];
  const negative: string[] = [];
  const terms: string[] = [];
  const exclude: string[] = [];
  const re = /(-?)"([^"]*)"|(-?)([^\s"]+)/gu;
  let m: RegExpExecArray | null;
  const endsWithBareWord = !/"\s*$/.test(q.trim());
  while ((m = re.exec(q)) && positive.length + negative.length < 12) {
    const neg = (m[1] || m[3]) === '-';
    const isPhrase = m[2] !== undefined;
    const raw = (isPhrase ? m[2] : m[4]) ?? '';
    const words = raw.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
    if (!words.length) {
      // symbols/emoji only (e.g. "🚀", "#"): nothing for the full-text index, but still a valid substring match for titles, folders and file names
      const lit = raw.trim().replace(/\*+$/, '').toLowerCase();
      if (lit) (neg ? exclude : terms).push(lit);
      continue;
    }
    const body = words.join(' ');
    const expr = `"${body}"`;
    // FTS gets the punctuation-free words; substring matching (titles, folders, filenames) keeps the raw text
    const literal = raw.trim().replace(/\*+$/, '').toLowerCase();
    if (neg) { negative.push(expr); exclude.push(literal); }
    else { positive.push(expr); terms.push(literal); }
  }
  if (!positive.length) return { fts: null, terms, exclude };
  // prefix-match the final bare word so results appear while typing
  if (endsWithBareWord) positive[positive.length - 1] += '*';
  return { fts: [positive.join(' '), ...negative.map((n) => `NOT ${n}`)].join(' '), terms, exclude };
}


export interface SearchOptions { type?: SearchType; scope?: string | null; sort?: SearchSort; limit?: number }

export async function search(q: string, opts: SearchOptions = {}): Promise<SearchResponse> {
  const query = q.trim();
  const empty: SearchResponse = { pages: [], folders: [], attachments: [] };
  if (!query) return empty;
  const type = opts.type ?? 'all';
  const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
  const workspaceId = await getWorkspaceId();
  const { folders, pages } = await loadMeta(workspaceId);
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const { fts, terms, exclude } = parseQuery(query);
  const matches = (text: string) => { const t = text.toLowerCase(); return terms.every((x) => t.includes(x)) && !exclude.some((x) => t.includes(x)); };

  // Optional scope: a folder or page id restricts results to that subtree.
  let allowedPages: Set<string> | null = null;
  let allowedFolders: Set<string> | null = null;
  if (opts.scope) {
    if (folders.some((f) => f.id === opts.scope)) {
      allowedFolders = folderSubtree(opts.scope, folders);
      allowedPages = pageSubtree([], allowedFolders, pages);
    } else if (pageById.has(opts.scope)) {
      allowedFolders = new Set();
      allowedPages = pageSubtree([opts.scope], new Set(), pages);
    } else return empty;
  }
  const inScope = (id: string) => !allowedPages || allowedPages.has(id);

  const result: SearchResponse = { pages: [], folders: [], attachments: [] };

  if (type === 'all' || type === 'pages') {
    const hits = new Map<string, { id: string; snippet: string; rank: number; titleMatch: boolean }>();
    if (fts) {
      const rows = await prisma.$queryRawUnsafe<{ id: string; snippet: string; rank: number }[]>(
        `SELECT p.id AS id, snippet(page_fts, 1, char(1), char(2), '…', 14) AS snippet, bm25(page_fts, 8.0, 1.0) AS rank
           FROM page_fts JOIN "Page" p ON p.rowid = page_fts.rowid
          WHERE page_fts MATCH ? AND p.deletedAt IS NULL AND p.workspaceId = ?
          ORDER BY rank LIMIT 200`,
        fts, workspaceId,
      );
      for (const r of rows) if (inScope(r.id)) hits.set(r.id, { id: r.id, snippet: r.snippet, rank: r.rank, titleMatch: false });
    }
    // Title substring matches ("rchit" finds "Architecture"), which FTS prefix matching cannot do.
    for (const p of pages) {
      if (!inScope(p.id) || !terms.length) continue;
      const title = p.title;
      if (matches(title)) {
        const existing = hits.get(p.id);
        if (existing) existing.titleMatch = true;
        else hits.set(p.id, { id: p.id, snippet: '', rank: 0, titleMatch: true });
      }
    }
    const rows = [...hits.values()];
    const needSnippet = rows.filter((r) => !r.snippet).map((r) => r.id);
    const bodies = needSnippet.length ? await prisma.page.findMany({ where: { id: { in: needSnippet } }, select: { id: true, contentText: true } }) : [];
    const bodyById = new Map(bodies.map((b) => [b.id, b.contentText]));
    const enriched = rows.map((r) => {
      const meta = pageById.get(r.id)!;
      return { ...r, meta, snippet: r.snippet || (bodyById.get(r.id) ?? '').replace(/\s+/g, ' ').slice(0, 140) };
    });
    enriched.sort((a, b) =>
      opts.sort === 'recent'
        ? b.meta.updatedAt.getTime() - a.meta.updatedAt.getTime()
        : Number(b.titleMatch) - Number(a.titleMatch) || a.rank - b.rank,
    );
    result.pages = enriched.slice(0, limit).map((r) => ({
      id: r.id, title: r.meta.title, snippet: r.snippet, path: pagePath(r.id, folders, pages), updatedAt: r.meta.updatedAt.toISOString(), titleMatch: r.titleMatch,
    }));
  }

  if ((type === 'all' || type === 'folders') && terms.length) {
    result.folders = folders
      .filter((f) => (!allowedFolders || allowedFolders.has(f.id)) && matches(f.name))
      .slice(0, limit)
      .map((f) => ({ id: f.id, name: f.name, path: folderPath(f.parentId, folders) }));
  }

  if ((type === 'all' || type === 'attachments') && terms.length) {
    const rows = await prisma.attachment.findMany({
      where: { page: { deletedAt: null, workspaceId }, AND: terms.map((t) => ({ filename: { contains: t } })), NOT: exclude.map((t) => ({ filename: { contains: t } })) },
      take: 200,
      orderBy: { createdAt: 'desc' },
    });
    result.attachments = rows
      .filter((a) => inScope(a.pageId) && pageById.has(a.pageId))
      .slice(0, limit)
      .map((a) => ({
        id: a.id, pageId: a.pageId, pageTitle: pageById.get(a.pageId)!.title, filename: a.filename, mime: a.mime,
        path: pagePath(a.pageId, folders, pages), url: `/api/attachments/${a.id}/file`,
      }));
  }
  return result;
}
