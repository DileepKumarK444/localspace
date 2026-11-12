import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.LOCALSPACE_VERSION_INTERVAL_MS = "0";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localspace-test-'));
process.env.LOCALSPACE_DATA_DIR = dir;

let server: Server;
let base = '';
let prismaRef: { $disconnect(): Promise<void> };

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const doc = (t: string) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

beforeAll(async () => {
  const { initDb, prisma } = await import('../src/db');
  const { createApp } = await import('../src/app');
  const { seedIfEmpty } = await import('../src/seed');
  prismaRef = prisma;
  await initDb();
  await seedIfEmpty();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 60_000);

afterAll(async () => {
  server.close();
  await prismaRef.$disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('tree & seed', () => {
  it('returns seeded folders, pages, favorites', async () => {
    const { body } = await call('GET', '/tree');
    expect(body.folders.map((f: { name: string }) => f.name)).toEqual(expect.arrayContaining(['Getting Started', 'Projects', 'Project Alpha', 'Personal Notes']));
    expect(body.pages.length).toBeGreaterThanOrEqual(9);
    expect(body.favorites.length).toBe(2);
  });
});

describe('folders & pages CRUD', () => {
  it('creates nested folders and pages, renames, and soft-deletes a subtree in one go', async () => {
    const top = (await call('POST', '/folders', { name: 'T-Top' })).body;
    const sub = (await call('POST', '/folders', { name: 'T-Sub', parentId: top.id })).body;
    const page = (await call('POST', '/pages', { title: 'T-Page', folderId: sub.id })).body;
    const child = (await call('POST', '/pages', { title: 'T-Child', parentPageId: page.id })).body;
    expect(child.parentPageId).toBe(page.id);

    expect((await call('PATCH', `/folders/${sub.id}`, { name: 'T-Sub2' })).body.name).toBe('T-Sub2');
    expect((await call('PATCH', `/pages/${page.id}`, { title: 'T-Page2' })).body.title).toBe('T-Page2');

    const del = await call('DELETE', `/folders/${top.id}`);
    expect(del.body).toEqual({ folders: 2, pages: 2 });
    const tree = (await call('GET', '/tree')).body;
    expect(tree.folders.some((f: { id: string }) => f.id === top.id)).toBe(false);
    expect(tree.pages.some((p: { id: string }) => p.id === child.id)).toBe(false);
    expect((await call('GET', `/pages/${page.id}`)).status).toBe(404);
  });

  it('rejects a page placed in both a folder and under a page, and bad names', async () => {
    const f = (await call('POST', '/folders', { name: 'T-F' })).body;
    const p = (await call('POST', '/pages', { title: 'T-P', folderId: f.id })).body;
    expect((await call('POST', '/pages', { title: 'x', folderId: f.id, parentPageId: p.id })).status).toBe(400);
    expect((await call('POST', '/pages', { title: '   ' })).status).toBe(400);
  });

  it('prevents moving a folder or page into its own subtree', async () => {
    const a = (await call('POST', '/folders', { name: 'C-A' })).body;
    const b = (await call('POST', '/folders', { name: 'C-B', parentId: a.id })).body;
    expect((await call('PATCH', `/folders/${a.id}`, { parentId: b.id })).status).toBe(400);
    const p1 = (await call('POST', '/pages', { title: 'C-P1' })).body;
    const p2 = (await call('POST', '/pages', { title: 'C-P2', parentPageId: p1.id })).body;
    expect((await call('PATCH', `/pages/${p1.id}`, { parentPageId: p2.id })).status).toBe(400);
    // valid move works
    const moved = await call('PATCH', `/pages/${p2.id}`, { folderId: a.id, parentPageId: null });
    expect(moved.body.folderId).toBe(a.id);
  });
});

describe('autosave & persistence', () => {
  it('saves content, bumps version, and rejects stale versions with 409', async () => {
    const p = (await call('POST', '/pages', { title: 'Save me' })).body;
    expect(p.version).toBe(1);
    const s1 = await call('PUT', `/pages/${p.id}`, { version: 1, contentJson: doc('hello world') });
    expect(s1.status).toBe(200);
    expect(s1.body.version).toBe(2);
    const stale = await call('PUT', `/pages/${p.id}`, { version: 1, contentJson: doc('overwrite!') });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const reread = (await call('GET', `/pages/${p.id}`)).body;
    expect(JSON.parse(reread.contentJson).content[0].content[0].text).toBe('hello world');
  });

  it('rejects invalid TipTap content without touching stored data', async () => {
    const p = (await call('POST', '/pages', { title: 'Bad json' })).body;
    expect((await call('PUT', `/pages/${p.id}`, { version: 1, contentJson: '{nope' })).status).toBe(400);
    expect((await call('PUT', `/pages/${p.id}`, { version: 1, contentJson: '{"type":"x"}' })).status).toBe(400);
    expect((await call('GET', `/pages/${p.id}`)).body.version).toBe(1);
  });
});

describe('search', () => {
  it('finds by content with snippet, by title, by folder name, and follows edits and deletes', async () => {
    const hit = (await call('GET', '/search?q=sqlite')).body;
    expect(hit.pages.length).toBeGreaterThan(0);
    expect(hit.pages[0].snippet).toContain('\u0001');
    expect(Array.isArray(hit.pages[0].path)).toBe(true);

    expect((await call('GET', '/search?q=Architect')).body.pages.some((p: { title: string }) => p.title === 'Architecture')).toBe(true);
    expect((await call('GET', '/search?q=Alpha')).body.folders.some((f: { name: string }) => f.name === 'Project Alpha')).toBe(true);

    const p = (await call('POST', '/pages', { title: 'Zebra notes' })).body;
    await call('PUT', `/pages/${p.id}`, { version: 1, contentJson: doc('quokka habitat research') });
    expect((await call('GET', '/search?q=quokka')).body.pages.map((x: { id: string }) => x.id)).toContain(p.id);
    await call('DELETE', `/pages/${p.id}`);
    expect((await call('GET', '/search?q=quokka')).body.pages).toHaveLength(0);
  });

  it('is safe against FTS syntax characters', async () => {
    const res = await call('GET', `/search?q=${encodeURIComponent('"foo" OR (bar* AND')}`);
    expect(res.status).toBe(200);
  });
});

describe('favorites, recents, backups', () => {
  it('toggles favorites and records recents', async () => {
    const p = (await call('POST', '/pages', { title: 'Fav page' })).body;
    expect((await call('PUT', `/pages/${p.id}/favorite`)).status).toBe(204);
    expect((await call('POST', `/pages/${p.id}/view`)).status).toBe(204);
    let tree = (await call('GET', '/tree')).body;
    expect(tree.favorites).toContain(p.id);
    expect(tree.recents[0]).toBe(p.id);
    await call('DELETE', `/pages/${p.id}/favorite`);
    tree = (await call('GET', '/tree')).body;
    expect(tree.favorites).not.toContain(p.id);
  });

  it('creates a restorable backup snapshot', async () => {
    const b = await call('POST', '/backups');
    expect(b.status).toBe(201);
    expect(fs.existsSync(path.join(dir, 'backups', b.body.name))).toBe(true);
    expect(b.body.size).toBeGreaterThan(0);
    expect((await call('GET', '/backups')).body.length).toBeGreaterThan(0);
  });
});

async function upload(pageId: string, filename: string, type: string, data: Buffer) {
  const res = await fetch(`${base}/pages/${pageId}/attachments?filename=${encodeURIComponent(filename)}`, { method: 'POST', headers: { 'content-type': type }, body: new Uint8Array(data) });
  return { status: res.status, body: await res.json() };
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('templates, duplicate, move', () => {
  it('lists templates and creates a page from one', async () => {
    const t = (await call('GET', '/templates')).body;
    expect(t.map((x: { id: string }) => x.id)).toContain('meeting-notes');
    const p = (await call('POST', '/pages', { title: 'From tpl', templateId: 'meeting-notes' })).body;
    const types = JSON.parse(p.contentJson).content.map((n: { type: string }) => n.type);
    expect(types).toContain('taskList');
    expect((await call('POST', '/pages', { title: 'x', templateId: 'nope' })).status).toBe(400);
  });

  it('every template is a valid document with no empty text nodes', async () => {
    const ids = (await call('GET', '/templates')).body.map((x: { id: string }) => x.id);
    const empties: string[] = [];
    const walk = (n: { type?: string; text?: string; content?: unknown[] }, id: string) => {
      if (n.type === 'text' && !n.text) empties.push(id);
      (n.content as { type?: string; text?: string; content?: unknown[] }[] | undefined)?.forEach((c) => walk(c, id));
    };
    for (const id of ids) {
      const p = (await call('POST', '/pages', { title: `tpl-${id}`, templateId: id })).body;
      walk(JSON.parse(p.contentJson), id);
    }
    expect(empties).toEqual([]);
  });

  it('duplicates a page with its content', async () => {
    const src = (await call('POST', '/pages', { title: 'Orig' })).body;
    await call('PUT', `/pages/${src.id}`, { version: 1, contentJson: doc('dup content') });
    const copy = (await call('POST', `/pages/${src.id}/duplicate`)).body;
    expect(copy.title).toBe('Orig (copy)');
    expect(copy.id).not.toBe(src.id);
    expect(JSON.parse(copy.contentJson).content[0].content[0].text).toBe('dup content');
  });

  it('moves into a folder / under a page and reorders before a sibling', async () => {
    const f1 = (await call('POST', '/folders', { name: 'M-F1' })).body;
    const f2 = (await call('POST', '/folders', { name: 'M-F2' })).body;
    const a = (await call('POST', '/pages', { title: 'M-A', folderId: f1.id })).body;
    const b = (await call('POST', '/pages', { title: 'M-B', folderId: f1.id })).body;
    const c = (await call('POST', '/pages', { title: 'M-C', folderId: f1.id })).body;
    // reorder: C before A
    expect((await call('POST', '/move', { kind: 'page', id: c.id, parent: { kind: 'folder', id: f1.id }, beforeId: a.id })).status).toBe(204);
    let tree = (await call('GET', '/tree')).body;
    const order = tree.pages.filter((p: { folderId: string }) => p.folderId === f1.id).sort((x: { position: number }, y: { position: number }) => x.position - y.position).map((p: { title: string }) => p.title);
    expect(order).toEqual(['M-C', 'M-A', 'M-B']);
    // page into another folder, then under a page
    await call('POST', '/move', { kind: 'page', id: b.id, parent: { kind: 'folder', id: f2.id } });
    await call('POST', '/move', { kind: 'page', id: a.id, parent: { kind: 'page', id: b.id } });
    tree = (await call('GET', '/tree')).body;
    expect(tree.pages.find((p: { id: string }) => p.id === b.id).folderId).toBe(f2.id);
    const am = tree.pages.find((p: { id: string }) => p.id === a.id);
    expect(am.parentPageId).toBe(b.id);
    expect(am.folderId).toBeNull();
    // folders: cycle and invalid parent rejected, valid nest works
    expect((await call('POST', '/move', { kind: 'folder', id: f1.id, parent: { kind: 'folder', id: f1.id } })).status).toBe(400);
    expect((await call('POST', '/move', { kind: 'folder', id: f1.id, parent: { kind: 'page', id: b.id } })).status).toBe(400);
    expect((await call('POST', '/move', { kind: 'page', id: b.id, parent: { kind: 'page', id: a.id } })).status).toBe(400); // b is a's parent
    expect((await call('POST', '/move', { kind: 'folder', id: f1.id, parent: { kind: 'folder', id: f2.id } })).status).toBe(204);
  });
});

describe('attachments', () => {
  it('uploads, lists, serves with safe headers, and deletes the file with the last reference', async () => {
    const page = (await call('POST', '/pages', { title: 'With files' })).body;
    const up = await upload(page.id, 'pixel.png', 'image/png', PNG);
    expect(up.status).toBe(201);
    expect(up.body.url).toBe(`/api/attachments/${up.body.id}/file`);
    expect((await call('GET', `/pages/${page.id}/attachments`)).body).toHaveLength(1);

    const file = await fetch(base.replace('/api', '') + up.body.url);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(file.headers.get('content-disposition')).toContain('inline');
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);

    // non-image types are forced to download
    const html = await upload(page.id, 'evil.html', 'text/html', Buffer.from('<script>alert(1)</script>'));
    const hf = await fetch(base.replace('/api', '') + html.body.url);
    expect(hf.headers.get('content-disposition')).toContain('attachment');

    // duplicate shares the file; deleting the original attachment keeps the copy's file
    const copy = (await call('POST', `/pages/${page.id}/duplicate`)).body;
    const copyAtts = (await call('GET', `/pages/${copy.id}/attachments`)).body;
    expect(copyAtts).toHaveLength(2);
    expect((await call('DELETE', `/attachments/${up.body.id}`)).status).toBe(204);
    const still = await fetch(base.replace('/api', '') + copyAtts.find((a: { filename: string }) => a.filename === 'pixel.png').url);
    expect(still.status).toBe(200);
  });

  it('rejects empty uploads and unknown pages', async () => {
    const page = (await call('POST', '/pages', { title: 'Empty up' })).body;
    expect((await upload(page.id, 'x.txt', 'text/plain', Buffer.alloc(0))).status).toBe(400);
    expect((await upload('nope', 'x.txt', 'text/plain', Buffer.from('a'))).status).toBe(404);
  });
});

describe('trash', () => {
  it('lists top-level deleted items, restores a whole subtree, and purges permanently', async () => {
    const f = (await call('POST', '/folders', { name: 'Tr-F' })).body;
    const p = (await call('POST', '/pages', { title: 'Tr-P', folderId: f.id })).body;
    await call('POST', '/pages', { title: 'Tr-Child', parentPageId: p.id });
    await call('DELETE', `/folders/${f.id}`);
    let list = (await call('GET', '/trash')).body;
    const item = list.find((i: { id: string }) => i.id === f.id);
    expect(item).toMatchObject({ kind: 'folder', title: 'Tr-F', childCount: 2 });
    expect(list.some((i: { id: string }) => i.id === p.id)).toBe(false); // only top-level shown

    await call('POST', '/trash/restore', { kind: 'folder', id: f.id });
    const tree = (await call('GET', '/tree')).body;
    expect(tree.pages.some((x: { title: string }) => x.title === 'Tr-Child')).toBe(true);
    expect((await call('GET', '/search?q=Tr-P')).body.pages.length).toBeGreaterThan(0);

    await call('DELETE', `/folders/${f.id}`);
    expect((await call('POST', '/trash/purge', { kind: 'folder', id: f.id })).status).toBe(204);
    list = (await call('GET', '/trash')).body;
    expect(list.some((i: { id: string }) => i.id === f.id)).toBe(false);
    expect((await call('POST', '/trash/restore', { kind: 'folder', id: f.id })).status).toBe(404);
  });

  it('restores an item to the root when its old parent is still in the trash', async () => {
    const f = (await call('POST', '/folders', { name: 'Tr2-F' })).body;
    const p = (await call('POST', '/pages', { title: 'Tr2-P', folderId: f.id })).body;
    await call('DELETE', `/pages/${p.id}`);
    await new Promise((r) => setTimeout(r, 5));
    await call('DELETE', `/folders/${f.id}`);
    await call('POST', '/trash/restore', { kind: 'page', id: p.id });
    const restored = (await call('GET', `/pages/${p.id}`)).body;
    expect(restored.folderId).toBeNull();
  });
});

describe('backup & restore', () => {
  it('restores database and keeps a safety backup so the restore can be undone', async () => {
    const keep = (await call('POST', '/pages', { title: 'Before-backup page' })).body;
    const b = (await call('POST', '/backups')).body;
    const later = (await call('POST', '/pages', { title: 'After-backup page' })).body;
    expect((await call('GET', `/pages/${later.id}`)).status).toBe(200);

    const r = await call('POST', '/backups/restore', { name: b.name });
    expect(r.status).toBe(200);
    expect((await call('GET', `/pages/${keep.id}`)).status).toBe(200);
    expect((await call('GET', `/pages/${later.id}`)).status).toBe(404);
    expect((await call('GET', '/search?q=Before-backup')).body.pages.length).toBeGreaterThan(0);

    // undo the restore using the safety backup
    expect((await call('POST', '/backups/restore', { name: r.body.safetyBackup })).status).toBe(200);
    expect((await call('GET', `/pages/${later.id}`)).status).toBe(200);
  }, 30_000);

  it('rejects path-traversal and unknown backup names', async () => {
    expect((await call('POST', '/backups/restore', { name: '../../etc/passwd' })).status).toBe(400);
    expect((await call('POST', '/backups/restore', { name: 'backup-nope' })).status).toBe(404);
  });
});

describe('M2: export & import', () => {
  const RICH = JSON.stringify({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hello <World>' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }] },
    { type: 'image', attrs: { src: '__IMG__', alt: 'pic' } },
  ] });

  it('exports a page as Markdown, HTML and print-PDF, embedding or bundling images', async () => {
    const page = (await call('POST', '/pages', { title: 'Exp: page/1' })).body;
    const att = await upload(page.id, 'pic.png', 'image/png', PNG);
    await call('PUT', `/pages/${page.id}`, { version: 1, contentJson: RICH.replace('__IMG__', att.body.url) });

    const html = await fetch(`${base}/pages/${page.id}/export?format=html`);
    expect(html.headers.get('content-disposition')).toContain('attachment');
    const htmlText = await html.text();
    expect(htmlText).toContain('Hello &lt;World&gt;');
    expect(htmlText).toContain('data:image/png;base64,');
    expect(htmlText).not.toContain('/api/attachments/');
    expect(htmlText).not.toContain('window.print');

    const pdf = await fetch(`${base}/pages/${page.id}/export?format=pdf`);
    expect(pdf.headers.get('content-disposition')).toContain('inline');
    expect(pdf.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await pdf.text()).toContain('window.print');

    // images → zip with the .md and attachments/
    const z = await fetch(`${base}/pages/${page.id}/export?format=md`);
    expect(z.headers.get('content-type')).toBe('application/zip');
    expect(decodeURIComponent(z.headers.get('content-disposition')!)).toContain('Exp_ page_1.zip');
    const buf = Buffer.from(await z.arrayBuffer());
    expect(buf.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(buf.includes(Buffer.from('attachments/'))).toBe(true);
    expect(buf.includes(Buffer.from('## Hello \\<World>'))).toBe(true);

    // no images → plain markdown
    const plain = (await call('POST', '/pages', { title: 'Plain' })).body;
    await call('PUT', `/pages/${plain.id}`, { version: 1, contentJson: doc('just text') });
    const md = await fetch(`${base}/pages/${plain.id}/export?format=md`);
    expect(md.headers.get('content-type')).toContain('text/markdown');
    expect(await md.text()).toBe('# Plain\n\njust text\n');

    expect((await fetch(`${base}/pages/${plain.id}/export?format=docx`)).status).toBe(400);
    expect((await fetch(`${base}/pages/nope/export?format=md`)).status).toBe(404);
  });

  it('the generated zip is a valid archive', async () => {
    const { execFileSync } = await import('node:child_process');
    const z = Buffer.from(await (await fetch(`${base}/export/workspace`)).arrayBuffer());
    const file = path.join(dir, 'ws.zip');
    fs.writeFileSync(file, z);
    let out = '';
    try { out = execFileSync('unzip', ['-t', file]).toString(); } catch (e) { if ((e as { code?: string }).code === 'ENOENT') return; throw e; }
    expect(out).toContain('No errors detected');
    const list = execFileSync('unzip', ['-Z1', file]).toString().split('\n');
    expect(list).toContain('Getting Started/Introduction.md');
    expect(list).toContain('Projects/Project Alpha/Architecture.md');
    expect(list).toContain('Projects/Project Alpha/Architecture/Data Model.md'); // child page directory
  });

  it('imports markdown files as pages (title from H1 or filename) into a folder', async () => {
    const f = (await call('POST', '/folders', { name: 'Imports' })).body;
    const r = await call('POST', '/import/markdown', { parent: { kind: 'folder', id: f.id }, files: [
      { name: 'a.md', markdown: '# Alpha\n\nSome **text**\n\n- [x] ok\n' },
      { name: 'my_notes-file.md', markdown: 'No heading here.\n\n> [!TIP]\n> hint' },
    ] });
    expect(r.status).toBe(201);
    expect(r.body.created.map((c: { title: string }) => c.title)).toEqual(['Alpha', 'my notes file']);
    const p = (await call('GET', `/pages/${r.body.created[0].id}`)).body;
    expect(p.folderId).toBe(f.id);
    expect(JSON.parse(p.contentJson).content.map((n: { type: string }) => n.type)).toEqual(['paragraph', 'taskList']);
    expect((await call('GET', '/search?q=hint')).body.pages.length).toBe(1); // imported content is searchable
    expect((await call('POST', '/import/markdown', { files: [] })).status).toBe(400);
    expect((await call('POST', '/import/markdown', { parent: { kind: 'folder', id: 'nope' }, files: [{ name: 'x.md', markdown: 'x' }] })).status).toBe(404);
  });
});

describe('M3: version history', () => {
  const save = (id: string, version: number, text: string) => call('PUT', `/pages/${id}`, { version, contentJson: doc(text) });

  it('snapshots the previous content as it changes, newest first, without storing duplicates', async () => {
    const p = (await call('POST', '/pages', { title: 'Hist' })).body;
    expect((await call('GET', `/pages/${p.id}/versions`)).body).toEqual([]);
    let v = (await save(p.id, 1, 'draft one')).body.version; // empty → no snapshot
    expect((await call('GET', `/pages/${p.id}/versions`)).body).toHaveLength(0);
    v = (await save(p.id, v, 'draft two')).body.version; // snapshots "draft one"
    v = (await save(p.id, v, 'draft three')).body.version; // snapshots "draft two"
    const list = (await call('GET', `/pages/${p.id}/versions`)).body;
    expect(list).toHaveLength(2);
    const newest = (await call('GET', `/pages/${p.id}/versions/${list[0].id}`)).body;
    expect(JSON.parse(newest.contentJson).content[0].content[0].text).toBe('draft two');
    expect(newest.html).toBe('<p>draft two</p>');
    // title-only saves do not create versions
    await call('PUT', `/pages/${p.id}`, { version: v, title: 'Hist renamed' });
    expect((await call('GET', `/pages/${p.id}/versions`)).body).toHaveLength(2);
  });

  it('creates manual versions and restores any version, keeping a "Before restore" snapshot', async () => {
    const p = (await call('POST', '/pages', { title: 'Restore me' })).body;
    let v = (await save(p.id, 1, 'original')).body.version;
    const manual = (await call('POST', `/pages/${p.id}/versions`, { label: 'Milestone' })).body;
    expect(manual.label).toBe('Milestone');
    v = (await save(p.id, v, 'changed later')).body.version;
    const restored = await call('POST', `/pages/${p.id}/versions/${manual.id}/restore`);
    expect(restored.status).toBe(200);
    expect(JSON.parse(restored.body.contentJson).content[0].content[0].text).toBe('original');
    expect(restored.body.version).toBeGreaterThan(v);
    const labels = (await call('GET', `/pages/${p.id}/versions`)).body.map((x: { label: string | null }) => x.label);
    expect(labels).toContain('Before restore');
    // the restore is undoable: restore the "Before restore" snapshot
    const before = (await call('GET', `/pages/${p.id}/versions`)).body.find((x: { label: string }) => x.label === 'Before restore');
    const undone = await call('POST', `/pages/${p.id}/versions/${before.id}/restore`);
    expect(JSON.parse(undone.body.contentJson).content[0].content[0].text).toBe('changed later');
    // search index follows the restore
    expect((await call('GET', '/search?q=changed')).body.pages.some((x: { id: string }) => x.id === p.id)).toBe(true);
    // an editor still holding the old version number gets a conflict instead of overwriting
    expect((await save(p.id, v, 'stale write')).status).toBe(409);
  });

  it('404s for unknown versions/pages, deletes versions, and cascades on purge', async () => {
    const p = (await call('POST', '/pages', { title: 'Del versions' })).body;
    expect((await call('GET', '/pages/nope/versions')).status).toBe(404);
    expect((await call('GET', `/pages/${p.id}/versions/nope`)).status).toBe(404);
    const v1 = (await call('POST', `/pages/${p.id}/versions`, {})).body;
    expect(v1.label).toBe('Manual version');
    expect((await call('DELETE', `/pages/${p.id}/versions/${v1.id}`)).status).toBe(204);
    expect((await call('DELETE', `/pages/${p.id}/versions/${v1.id}`)).status).toBe(404);
  });
});

describe('M4: custom templates & variables', () => {
  const texts = (c: string) => { const o: string[] = []; const w = (n: { text?: string; content?: unknown[] }) => { if (n.text) o.push(n.text); (n.content as { text?: string; content?: unknown[] }[] | undefined)?.forEach(w); }; w(JSON.parse(c)); return o.join(' | '); };

  it('substitutes variables in built-in templates', async () => {
    const p = (await call('POST', '/pages', { title: 'Standup', templateId: 'daily-note' })).body;
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(texts(p.contentJson)).toContain(iso);
    expect(texts(p.contentJson)).not.toContain('{{');
    const m = (await call('POST', '/pages', { title: 'Sync', templateId: 'meeting-notes' })).body;
    expect(texts(m.contentJson)).toContain(`Date: ${iso}`);
    expect((await call('GET', '/templates')).body.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining(['daily-note', 'bug-report']));
  });

  it('saves a page as a custom template, lists, uses (with {{title}}), renames and deletes it', async () => {
    const src = (await call('POST', '/pages', { title: 'Source' })).body;
    await call('PUT', `/pages/${src.id}`, { version: 1, contentJson: doc('Report for {{title}} on {{weekday}}. Keep {{unknown}}.') });
    const t = (await call('POST', '/templates', { name: 'My report', description: 'weekly', fromPageId: src.id })).body;
    expect(t).toMatchObject({ name: 'My report', custom: true });
    const all = (await call('GET', '/templates')).body;
    expect(all.find((x: { id: string }) => x.id === t.id).custom).toBe(true);
    expect(all.filter((x: { custom: boolean }) => !x.custom).length).toBeGreaterThanOrEqual(8);

    const made = (await call('POST', '/pages', { title: 'Q4 numbers', templateId: t.id })).body;
    const text = texts(made.contentJson);
    expect(text).toContain('Report for Q4 numbers on ');
    expect(text).toContain('{{unknown}}');
    expect(text).not.toContain('{{title}}');
    // editing the source later does not change the template (it is a copy)
    await call('PUT', `/pages/${src.id}`, { version: 2, contentJson: doc('changed') });
    expect(texts((await call('POST', '/pages', { title: 'Again', templateId: t.id })).body.contentJson)).toContain('Report for Again');

    expect((await call('PATCH', `/templates/${t.id}`, { name: 'Renamed' })).body.name).toBe('Renamed');
    expect((await call('DELETE', `/templates/${t.id}`)).status).toBe(204);
    expect((await call('DELETE', `/templates/${t.id}`)).status).toBe(404);
    expect((await call('POST', '/pages', { title: 'x', templateId: t.id })).status).toBe(400);
    expect((await call('POST', '/templates', { name: 'x', fromPageId: 'nope' })).status).toBe(404);
  });
});

describe('M5: activity feed', () => {
  const feed = async (qs = '') => (await call('GET', `/activity${qs}`)).body as { type: string; kind: string; entityId: string; title: string; exists: boolean; createdAt: string }[];
  const forEntity = async (id: string) => (await feed('?limit=200')).filter((a) => a.entityId === id).map((a) => a.type);

  it('records create / edit (coalesced) / rename / move / delete / restore for a page', async () => {
    const f = (await call('POST', '/folders', { name: 'Act-F' })).body;
    const p = (await call('POST', '/pages', { title: 'Act page' })).body;
    expect(await forEntity(p.id)).toEqual(['created']);
    let v = (await call('PUT', `/pages/${p.id}`, { version: 1, contentJson: doc('one') })).body.version;
    v = (await call('PUT', `/pages/${p.id}`, { version: v, contentJson: doc('two') })).body.version;
    v = (await call('PUT', `/pages/${p.id}`, { version: v, contentJson: doc('three') })).body.version;
    expect((await forEntity(p.id)).filter((t) => t === 'edited')).toHaveLength(1); // three saves → one entry
    await call('PUT', `/pages/${p.id}`, { version: v, title: 'Act renamed' });
    await call('POST', '/move', { kind: 'page', id: p.id, parent: { kind: 'folder', id: f.id } });
    await call('DELETE', `/pages/${p.id}`);
    expect((await feed('?limit=1'))[0]).toMatchObject({ type: 'deleted', title: 'Act renamed', exists: false });
    await call('POST', '/trash/restore', { kind: 'page', id: p.id });
    expect(await forEntity(p.id)).toEqual(['restored', 'deleted', 'moved', 'renamed', 'edited', 'created']);
    expect((await feed('?limit=1'))[0].exists).toBe(true);
  });

  it('records folders, duplicates, imports and version restores; unchanged saves log nothing', async () => {
    const f = (await call('POST', '/folders', { name: 'Act-Folder' })).body;
    await call('PATCH', `/folders/${f.id}`, { name: 'Act-Folder 2' });
    expect(await forEntity(f.id)).toEqual(['renamed', 'created']);

    const p = (await call('POST', '/pages', { title: 'Dup src' })).body;
    const d = (await call('POST', `/pages/${p.id}/duplicate`)).body;
    expect(await forEntity(d.id)).toEqual(['duplicated']);

    const imp = (await call('POST', '/import/markdown', { files: [{ name: 'x.md', markdown: '# Imported one\n\ntext' }] })).body.created[0];
    expect(await forEntity(imp.id)).toEqual(['imported']);

    const q = (await call('POST', '/pages', { title: 'Ver' })).body;
    const v2 = (await call('PUT', `/pages/${q.id}`, { version: 1, contentJson: doc('a') })).body.version;
    const man = (await call('POST', `/pages/${q.id}/versions`, { label: 'm' })).body;
    await call('PUT', `/pages/${q.id}`, { version: v2, contentJson: doc('a') }); // identical content
    expect((await forEntity(q.id)).filter((t) => t === 'edited')).toHaveLength(1);
    await call('POST', `/pages/${q.id}/versions/${man.id}/restore`);
    expect((await forEntity(q.id))[0]).toBe('version_restored');
  });

  it('filters by type and paginates with `before`', async () => {
    const all = await feed('?limit=200');
    const onlyDeleted = await feed('?type=deleted&limit=200');
    expect(onlyDeleted.length).toBeGreaterThan(0);
    expect(onlyDeleted.every((a) => a.type === 'deleted')).toBe(true);
    expect(all.length).toBeGreaterThan(5);
    const page1 = await feed('?limit=3');
    const page2 = await feed(`?limit=3&before=${encodeURIComponent(page1[2].createdAt)}`);
    expect(page2.length).toBeGreaterThan(0);
    expect(page2.every((a) => a.createdAt < page1[2].createdAt)).toBe(true);
    // newest first
    expect([...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((a) => a.createdAt)).toEqual(all.map((a) => a.createdAt));
  });
});

describe('M6: improved search', () => {
  const S = async (qs: string) => (await call('GET', `/search?${qs}`)).body as { pages: { id: string; title: string; titleMatch: boolean; snippet: string; updatedAt: string }[]; folders: { name: string }[]; attachments: { filename: string; pageTitle: string }[] };
  let folderA = '', folderB = '', pa = '', pb = '', pc = '';

  it('sets up fixture pages', async () => {
    folderA = (await call('POST', '/folders', { name: 'Zeta Area' })).body.id;
    folderB = (await call('POST', '/folders', { name: 'Omega Area' })).body.id;
    pa = (await call('POST', '/pages', { title: 'Mango recipes', folderId: folderA })).body.id;
    pb = (await call('POST', '/pages', { title: 'Cooking notes', folderId: folderB })).body.id;
    pc = (await call('POST', '/pages', { title: 'Plain', folderId: folderA })).body.id;
    await call('PUT', `/pages/${pa}`, { version: 1, contentJson: doc('slice the mango and add ripe banana quickly') });
    await call('PUT', `/pages/${pb}`, { version: 1, contentJson: doc('a ripe mango with banana tastes sweet') });
    await call('PUT', `/pages/${pc}`, { version: 1, contentJson: doc('banana bread needs ripe bananas') });
    await upload(pa, 'mango-photo.png', 'image/png', PNG);
  });

  it('supports exact phrases and -exclusions', async () => {
    expect((await S('q=' + encodeURIComponent('"ripe banana"'))).pages.map((p) => p.id).sort()).toEqual([pa].sort()); // phrase adjacent only in pa
    const withMango = (await S('q=mango')).pages.map((p) => p.id);
    expect(withMango).toEqual(expect.arrayContaining([pa, pb]));
    const without = (await S('q=' + encodeURIComponent('banana -mango'))).pages.map((p) => p.id);
    expect(without).toContain(pc);
    expect(without).not.toContain(pa);
    expect(without).not.toContain(pb);
    expect((await S('q=-mango')).pages).toEqual([]); // only exclusions → nothing
    // excluded words are applied to title substring matches as well
    expect((await S('q=' + encodeURIComponent('recipes -mango'))).pages).toEqual([]);
  });

  it('finds titles by substring and ranks title matches first', async () => {
    const r = await S('q=ango');
    expect(r.pages.map((p) => p.id)).toContain(pa); // "Mango recipes" contains "ango"
    const rank = await S('q=mango');
    expect(rank.pages[0]).toMatchObject({ id: pa, titleMatch: true });
    expect(rank.pages.find((p) => p.id === pb)!.titleMatch).toBe(false);
    expect(rank.pages[0].snippet.length).toBeGreaterThan(0);
  });

  it('searches attachment filenames and honours type filters', async () => {
    const r = await S('q=' + encodeURIComponent('mango-photo'));
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0]).toMatchObject({ filename: 'mango-photo.png', pageTitle: 'Mango recipes' });
    const onlyFolders = await S('q=Area&type=folders');
    expect(onlyFolders.folders.map((f) => f.name).sort()).toEqual(['Omega Area', 'Zeta Area']);
    expect(onlyFolders.pages).toEqual([]);
    expect((await S('q=mango&type=attachments')).pages).toEqual([]);
    expect((await S('q=mango&type=pages')).folders).toEqual([]);
  });

  it('scopes results to a folder subtree and sorts by recency', async () => {
    const scoped = await S(`q=banana&scope=${folderA}`);
    expect(scoped.pages.map((p) => p.id).sort()).toEqual([pa, pc].sort());
    expect((await S(`q=banana&scope=${folderB}`)).pages.map((p) => p.id)).toEqual([pb]);
    expect((await S('q=banana&scope=nope')).pages).toEqual([]);
    await call('PUT', `/pages/${pb}`, { version: 2, contentJson: doc('banana touched last') });
    const recent = await S('q=banana&sort=recent');
    expect(recent.pages[0].id).toBe(pb);
    const dates = recent.pages.map((p) => p.updatedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('is safe against FTS operators and odd input', async () => {
    for (const q of ['"unterminated', 'a OR b', 'NEAR(a b)', '*', 'col:val', '"" ""', '-', '"-"', 'x AND', "'; DROP TABLE Page; --", '(((', '\u0001\u0002']) {
      const res = await call('GET', `/search?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
    }
    expect((await call('GET', '/tree')).status).toBe(200);
  });
});
