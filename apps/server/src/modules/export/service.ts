import fs from 'node:fs';
import path from 'node:path';
import { docToHtml, docToMarkdown, htmlDocument, type DocNode } from '@localspace/shared';
import { attachmentsDir } from '../../config';
import { getWorkspaceId, prisma } from '../../db';
import { badRequest, notFound } from '../../errors';
import { loadMeta } from '../tree/hierarchy';
import { makeZip, type ZipEntry } from './zip';

export interface ExportResult { filename: string; contentType: string; body: Buffer | string; inline?: boolean }

const ATT_RE = /^\/api\/attachments\/([a-f0-9]+)\/file$/;
export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 100) || 'untitled';

async function loadAttachment(src: string) {
  const id = ATT_RE.exec(src)?.[1];
  if (!id) return null;
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a) return null;
  const abs = path.join(attachmentsDir, a.storagePath);
  if (!abs.startsWith(attachmentsDir + path.sep) || !fs.existsSync(abs)) return null;
  return { ...a, data: fs.readFileSync(abs) };
}

const imageSrcs = (doc: DocNode): string[] => {
  const out: string[] = [];
  const walk = (n: DocNode) => { if (n.type === 'image' && typeof n.attrs?.src === 'string') out.push(n.attrs.src); n.content?.forEach(walk); };
  walk(doc);
  return out;
};

export async function exportPage(id: string, format: string): Promise<ExportResult> {
  const page = await prisma.page.findFirst({ where: { id, deletedAt: null } });
  if (!page) throw notFound('Page');
  const doc = JSON.parse(page.contentJson) as DocNode;
  const base = safeFileName(page.title);

  if (format === 'html' || format === 'pdf') {
    // Embed local images so the file is self-contained.
    const embedded = new Map<string, string>();
    for (const src of new Set(imageSrcs(doc))) {
      const a = await loadAttachment(src);
      if (a) embedded.set(src, `data:${/^image\//.test(a.mime) ? a.mime : 'application/octet-stream'};base64,${a.data.toString('base64')}`);
    }
    const html = htmlDocument(page.title, doc, { print: format === 'pdf', imageSrc: (s) => (ATT_RE.test(s) ? embedded.get(s) ?? null : s) });
    return { filename: `${base}.html`, contentType: 'text/html; charset=utf-8', body: html, inline: format === 'pdf' };
  }

  if (format === 'md') {
    const files: ZipEntry[] = [];
    const names = new Map<string, string>();
    for (const src of new Set(imageSrcs(doc))) {
      const a = await loadAttachment(src);
      if (!a) continue;
      const name = `${a.id.slice(0, 6)}-${safeFileName(a.filename)}`;
      names.set(src, `attachments/${encodeURI(name)}`);
      files.push({ name: `attachments/${name}`, data: a.data });
    }
    const md = `# ${page.title}\n\n` + docToMarkdown(doc, { imageSrc: (s) => (ATT_RE.test(s) ? names.get(s) ?? null : s) });
    if (!files.length) return { filename: `${base}.md`, contentType: 'text/markdown; charset=utf-8', body: md };
    return { filename: `${base}.zip`, contentType: 'application/zip', body: makeZip([{ name: `${base}.md`, data: Buffer.from(md) }, ...files]) };
  }
  throw badRequest('format must be md, html or pdf');
}

/** Whole workspace as a ZIP: folders become directories, pages become .md files (child pages go in a sibling directory). */
export async function exportWorkspace(): Promise<ExportResult> {
  const workspaceId = await getWorkspaceId();
  const { folders, pages } = await loadMeta(workspaceId);
  const entries: ZipEntry[] = [];
  const attFiles = new Map<string, string>(); // attachment id -> zip path
  const used = new Set<string>();
  const unique = (p: string) => {
    let c = p, i = 2;
    while (used.has(c.toLowerCase())) c = p.replace(/(\.md)?$/, ` (${i++})$1`);
    used.add(c.toLowerCase());
    return c;
  };
  const folderDir = new Map<string, string>();
  const dirOf = (fid: string | null): string => {
    if (!fid) return '';
    const cached = folderDir.get(fid);
    if (cached !== undefined) return cached;
    const f = folders.find((x) => x.id === fid);
    const dir = f ? `${dirOf(f.parentId)}${safeFileName(f.name)}/` : '';
    folderDir.set(fid, dir);
    return dir;
  };
  const pageDir = (p: (typeof pages)[number]): string => {
    if (p.parentPageId) {
      const parent = pages.find((x) => x.id === p.parentPageId);
      return parent ? `${pageDir(parent)}${safeFileName(parent.title)}/` : '';
    }
    return dirOf(p.folderId);
  };
  for (const meta of pages) {
    const page = await prisma.page.findUniqueOrThrow({ where: { id: meta.id } });
    const doc = JSON.parse(page.contentJson) as DocNode;
    const dir = pageDir(meta);
    const rel = '../'.repeat(dir.split('/').filter(Boolean).length);
    const localMap = new Map<string, string>();
    for (const src of new Set(imageSrcs(doc))) {
      const a = await loadAttachment(src);
      if (!a) continue;
      let zipPath = attFiles.get(a.id);
      if (!zipPath) { zipPath = `attachments/${a.id.slice(0, 6)}-${safeFileName(a.filename)}`; attFiles.set(a.id, zipPath); entries.push({ name: zipPath, data: a.data }); }
      localMap.set(src, rel + encodeURI(zipPath));
    }
    const md = `# ${page.title}\n\n` + docToMarkdown(doc, { imageSrc: (s) => (ATT_RE.test(s) ? localMap.get(s) ?? null : s) });
    entries.push({ name: unique(`${dir}${safeFileName(page.title)}.md`), data: Buffer.from(md) });
  }
  for (const f of folders) used.add(dirOf(f.id).toLowerCase());
  if (!entries.length) entries.push({ name: 'README.txt', data: Buffer.from('This workspace is empty.\n') });
  return { filename: 'localspace-export.zip', contentType: 'application/zip', body: makeZip(entries) };
}
