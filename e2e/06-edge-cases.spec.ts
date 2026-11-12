import { expect, test } from '@playwright/test';
import { editor, node, openPage, status } from './helpers';
import { assertIntegrity } from './helpers2';
import { TestServer, doc } from './server';

const server = new TestServer();
test.beforeAll(() => server.start());
test.afterAll(() => server.cleanup());

test.describe.serial('edge cases and hostile input', () => {
  test('HTML/script in titles, folder names and content is shown as text and never executed', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    const evilTitle = '<img src=x onerror="alert(\'title\')"><script>alert("t2")</script>';
    await server.api('POST', '/folders', { name: '<b onmouseover="alert(1)">Evil folder</b>' });
    const p = await server.api('POST', '/pages', { title: evilTitle });
    await server.api('PUT', `/pages/${p.id}`, { version: 1, contentJson: JSON.stringify({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '<script>alert("body")</script><img src=x onerror=alert(2)>' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(3)' } }] }] },
    ] }) });
    await page.goto(`${server.url}/page/${p.id}`);
    await expect(page.locator('.title')).toHaveValue(evilTitle);
    await expect(editor(page)).toContainText('<script>alert("body")</script>');
    await expect(page.locator('.crumbs')).toContainText('<img src=x');
    await expect(node(page, '<b onmouseover="alert\\(1\\)">Evil folder</b>')).toBeVisible();
    // the stored javascript: link is neutralised when rendered by the editor
    expect(await editor(page).locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))).not.toContain('javascript:alert(3)');
    // search results, history preview, activity feed
    await page.keyboard.press('Control+k');
    await page.locator('.palette input').fill('alert');
    await page.waitForTimeout(500);
    await expect(page.locator('.palette')).toContainText('<script>');
    await page.keyboard.press('Escape');
    await page.goto(`${server.url}/activity`);
    await expect(page.locator('.act-row').first()).toBeVisible();
    await page.goto(`${server.url}/page/${p.id}`);
    await page.getByRole('button', { name: 'Version history' }).click();
    await page.getByRole('button', { name: 'Save version' }).click();
    await page.getByRole('dialog', { name: 'Save a version' }).locator('input').fill('<i>v</i>');
    await page.getByRole('dialog', { name: 'Save a version' }).getByRole('button', { name: 'Save version' }).click();
    await expect(page.locator('.v-preview .ProseMirror')).toContainText('<script>alert("body")</script>');
    expect(await page.locator('.v-preview .ProseMirror script, .v-preview .ProseMirror img[src="x"]').count()).toBe(0);
    // exports
    const html = await (await fetch(`${server.url}/api/pages/${p.id}/export?format=html`)).text();
    expect(html).not.toMatch(/<script>alert|<img src=x|javascript:alert/);
    expect(html).toContain('&lt;script&gt;');
    expect(dialogs).toEqual([]); // nothing ever executed
  });

  test('unicode, emoji, RTL and mixed scripts round-trip and are searchable', async ({ page }) => {
    const text = 'Café crème 🎉 naïve — 日本語のテキスト עברית مرحبا Ünïcödé';
    const p = await server.api('POST', '/pages', { title: 'Ünïcode 🚀 日本' });
    await server.api('PUT', `/pages/${p.id}`, { version: 1, contentJson: doc(text) });
    await openPage(page, server, 'Ünïcode 🚀 日本');
    await expect(editor(page)).toContainText(text);
    const search = async (q: string) => (await server.api('GET', `/search?q=${encodeURIComponent(q)}`)).pages.map((x: any) => x.title);
    expect(await search('cafe')).toContain('Ünïcode 🚀 日本'); // diacritics folded
    expect(await search('naive')).toContain('Ünïcode 🚀 日本');
    expect(await search('crème')).toContain('Ünïcode 🚀 日本');
    expect(await search('مرحبا')).toContain('Ünïcode 🚀 日本');
    expect(await search('עברית')).toContain('Ünïcode 🚀 日本');
    expect(await search('🚀')).toContain('Ünïcode 🚀 日本'); // emoji in a title (substring match)
    // typing emoji/unicode through the real keyboard saves intact
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' ✅ ñandú');
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    expect((await server.api('GET', `/pages/${p.id}`)).contentJson).toContain('✅ ñandú');
  });

  test('names: empty/whitespace/too-long are handled; duplicates are allowed', async ({ page }) => {
    const id = await openPage(page, server, 'Ünïcode 🚀 日本');
    await page.locator('.title').fill('   ');
    await page.locator('.title').blur();
    await expect(page.locator('.title')).toHaveValue('Untitled page'); // never saves an empty title
    await expect.poll(async () => (await server.api('GET', `/pages/${id}`)).title).toBe('Untitled page');
    expect(await fetch(`${server.url}/api/pages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x'.repeat(201) }) }).then((r) => r.status)).toBe(400);
    expect(await fetch(`${server.url}/api/folders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '   ' }) }).then((r) => r.status)).toBe(400);
    // rename to blank in the tree is ignored
    await node(page, 'Untitled page').press('F2');
    await page.locator('.rename').fill('   ');
    await page.locator('.rename').press('Enter');
    await expect(node(page, 'Untitled page')).toBeVisible();
    // duplicates allowed
    await server.api('POST', '/pages', { title: 'Same name' });
    await server.api('POST', '/pages', { title: 'Same name' });
    expect((await server.api('GET', '/tree')).pages.filter((p: any) => p.title === 'Same name')).toHaveLength(2);
  });

  test('a very large page (20,000 words) saves, reloads and searches quickly', async ({ page }) => {
    const words = Array.from({ length: 20000 }, (_, i) => `word${i % 500}`).join(' ');
    const paragraphs = Array.from({ length: 200 }, (_, i) => words.split(' ').slice(i * 100, i * 100 + 100).join(' '));
    const p = await server.api('POST', '/pages', { title: 'Huge page' });
    const t0 = Date.now();
    await server.api('PUT', `/pages/${p.id}`, { version: 1, contentJson: doc(...paragraphs, 'needle-in-haystack') });
    expect(Date.now() - t0).toBeLessThan(3000);
    const s0 = Date.now();
    expect((await server.api('GET', '/search?q=needle')).pages.map((x: any) => x.title)).toContain('Huge page');
    expect(Date.now() - s0).toBeLessThan(1500);
    const l0 = Date.now();
    await openPage(page, server, 'Huge page');
    await expect(editor(page)).toContainText('needle-in-haystack');
    expect(Date.now() - l0).toBeLessThan(8000);
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' typed at the end');
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    assertIntegrity(server);
  });

  test('deeply nested folders and pages (12 levels) navigate, breadcrumb and delete correctly', async ({ page }) => {
    let parent: string | null = null;
    const folders: string[] = [];
    for (let i = 1; i <= 6; i++) { const f: any = await server.api('POST', '/folders', { name: `Level ${i}`, parentId: parent }); folders.push(f.id); parent = f.id; }
    let pageParent: string | null = null;
    let deepest = '';
    for (let i = 1; i <= 6; i++) {
      const p: any = await server.api('POST', '/pages', pageParent ? { title: `Page depth ${i}`, parentPageId: pageParent } : { title: `Page depth ${i}`, folderId: parent });
      pageParent = p.id; deepest = p.id;
    }
    await page.goto(`${server.url}/page/${deepest}`);
    await expect(page.locator('.title')).toHaveValue('Page depth 6');
    const crumbs = await page.locator('.crumbs a, .crumbs .cur').allTextContents();
    expect(crumbs.filter(Boolean)).toEqual([...Array.from({ length: 6 }, (_, i) => `Level ${i + 1}`), ...Array.from({ length: 6 }, (_, i) => `Page depth ${i + 1}`)]);
    await expect(node(page, 'Page depth 6')).toHaveClass(/sel/);
    await server.api('DELETE', `/folders/${folders[0]}`);
    const tree = await server.api('GET', '/tree');
    expect(tree.pages.some((p: any) => p.title.startsWith('Page depth'))).toBe(false);
    expect(tree.folders.some((f: any) => f.name.startsWith('Level '))).toBe(false);
    const trash = await server.api('GET', '/trash');
    expect(trash.find((t: any) => t.title === 'Level 1')?.childCount).toBe(11); // 5 subfolders + 6 pages
    await server.api('POST', '/trash/restore', { kind: 'folder', id: folders[0] });
    expect((await server.api('GET', '/tree')).pages.filter((p: any) => p.title.startsWith('Page depth'))).toHaveLength(6);
    assertIntegrity(server);
  });

  test('opening a missing or deleted page/folder shows a helpful message, not a crash', async ({ page }) => {
    await page.goto(`${server.url}/page/does-not-exist`);
    await expect(page.getByText('This page no longer exists')).toBeVisible();
    await page.goto(`${server.url}/folder/does-not-exist`);
    await expect(page.getByText('This folder no longer exists')).toBeVisible();
    await page.goto(`${server.url}/totally/unknown/route`);
    await expect(page).toHaveURL(/\/page\//); // unknown routes fall back to home
    const p = await server.api('POST', '/pages', { title: 'Will vanish' });
    await openPage(page, server, 'Will vanish');
    await server.api('DELETE', `/pages/${p.id}`);
    await page.reload();
    await expect(page.getByText('This page no longer exists')).toBeVisible();
    await page.getByRole('link', { name: /workspace home/ }).click();
    await expect(page.locator('.title')).toBeVisible();
  });
});
