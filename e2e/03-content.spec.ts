import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { confirmDialog, editor, openFolder, openPage, status, goToEnd } from './helpers';
import { PNG, TestServer, doc } from './server';

const server = new TestServer();
test.beforeAll(() => server.start());
test.afterAll(() => server.cleanup());

const mk = async (title: string, text?: string, folderId?: string) => {
  const p = await server.api('POST', '/pages', { title, ...(folderId ? { folderId } : {}) });
  if (text) await server.api('PUT', `/pages/${p.id}`, { version: 1, contentJson: doc(text) });
  return p.id as string;
};
const imgLoaded = (page: import('@playwright/test').Page) => page.locator('.ProseMirror img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0);

test.describe.serial('content: attachments, search accuracy, export & import', () => {
  test('upload an image with the file picker; it renders, persists, and shows in the attachments panel', async ({ page }) => {
    await mk('Files page');
    await openPage(page, server, 'Files page');
    await page.locator('.main input[type=file]').setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.ProseMirror img')).toHaveCount(1);
    expect(await imgLoaded(page)).toBe(true);
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(page.locator('.ProseMirror img')).toHaveCount(1);
    expect(await imgLoaded(page)).toBe(true);
    await page.getByRole('button', { name: 'Attachments' }).click();
    await expect(page.locator('.att-row')).toHaveCount(1);
    await expect(page.locator('.att-row')).toContainText('pic.png');
    // stored on disk with the right bytes
    const files = fs.readdirSync(path.join(server.dir, 'attachments'), { recursive: true }).filter((f) => /\.png$/.test(String(f)));
    expect(files).toHaveLength(1);
    expect(fs.readFileSync(path.join(server.dir, 'attachments', String(files[0]))).equals(PNG)).toBe(true);
  });

  test('image width presets are saved', async ({ page }) => {
    await openPage(page, server, 'Files page');
    await page.locator('.ProseMirror img').click();
    await page.getByRole('button', { name: 'Image width 50%' }).click();
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(page.locator('.ProseMirror img')).toHaveAttribute('data-width', '50%');
  });

  test('pasting and dropping files into the editor uploads them', async ({ page }) => {
    await openPage(page, server, 'Files page');
    await editor(page).click();
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'pasted.png', { type: 'image/png' });
      const dt = new DataTransfer(); dt.items.add(file);
      document.querySelector('.ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG.toString('base64'));
    await expect(page.locator('.ProseMirror img')).toHaveCount(2);
    await page.evaluate(() => {
      const file = new File(['plain text file'], 'notes.txt', { type: 'text/plain' });
      const dt = new DataTransfer(); dt.items.add(file);
      const ed = document.querySelector('.ProseMirror')!;
      const r = ed.getBoundingClientRect();
      ed.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 }));
    });
    await expect(editor(page).locator('a', { hasText: 'notes.txt' })).toHaveCount(1);
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    expect((await server.api('GET', `/pages/${(await server.api('GET', '/tree')).pages.find((p: any) => p.title === 'Files page').id}/attachments`)).length).toBe(3);
    // the non-image is served as a download, never inline
    const href = await editor(page).locator('a', { hasText: 'notes.txt' }).getAttribute('href');
    const res = await fetch(server.url + href!);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  test('an over-size upload is rejected with a visible error and leaves no file behind', async ({ page }) => {
    await openPage(page, server, 'Files page');
    const before = fs.readdirSync(path.join(server.dir, 'attachments'), { recursive: true }).length;
    await page.locator('.main input[type=file]').setInputFiles({ name: 'huge.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(26 * 1024 * 1024, 1) });
    await expect(page.locator('.toast.error')).toContainText(/huge\.bin/);
    expect(fs.readdirSync(path.join(server.dir, 'attachments'), { recursive: true }).length).toBe(before);
  });

  test('deleting an attachment removes its row and file; purging a page removes its files', async ({ page }) => {
    await openPage(page, server, 'Files page');
    await page.getByRole('button', { name: 'Attachments' }).click();
    const row = page.locator('.att-row', { hasText: 'notes.txt' });
    await row.getByRole('button', { name: 'Delete attachment' }).click();
    await confirmDialog(page).getByRole('button', { name: 'Delete file' }).click();
    await expect(row).toHaveCount(0);
    expect(server.sql("select count(*) from Attachment where filename='notes.txt'")).toBe('0');
    const id = (await server.api('GET', '/tree')).pages.find((p: any) => p.title === 'Files page').id;
    await server.api('DELETE', `/pages/${id}`);
    await server.api('POST', '/trash/purge', { kind: 'page', id });
    expect(fs.readdirSync(path.join(server.dir, 'attachments'), { recursive: true }).filter((f) => /\.\w+$/.test(String(f)))).toHaveLength(0);
  });

  test('search is accurate: finds fresh edits, phrases, exclusions, substrings; forgets deleted pages; remembers restored ones', async ({ page }) => {
    const f = (await server.api('POST', '/folders', { name: 'Fruit' })).id;
    await mk('Mango recipes', 'slice the ripe mango and add banana', f);
    await mk('Banana bread', 'ripe bananas and flour');
    await page.goto(server.url);
    const search = async (q: string) => {
      await page.keyboard.press('Control+k');
      await page.locator('.palette input').fill(q);
      await page.waitForTimeout(450);
      const titles = await page.locator('.palette .res b').allTextContents();
      if (process.env.DEBUG_SEARCH) console.log('PALETTE', q, JSON.stringify(await page.locator('.palette').innerText()));
      await page.keyboard.press('Escape');
      return titles;
    };
    expect(await search('mango')).toContain('Mango recipes');
    expect(await search('"ripe mango"')).toEqual(['Mango recipes']);
    expect(await search('ripe -mango')).toEqual(['Banana bread']);
    expect(await search('ango')).toContain('Mango recipes'); // substring of a title
    expect(await search('Fruit')).toContain('Fruit'); // folder name

    // edit through the UI → searchable after autosave
    await openPage(page, server, 'Banana bread');
    await editor(page).click();
    await goToEnd(page);
    await page.keyboard.type(' zucchini');
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    expect(await search('zucchini')).toEqual(['Banana bread']);

    // delete → gone; restore → back
    const id = (await server.api('GET', '/tree')).pages.find((p: any) => p.title === 'Banana bread').id;
    await server.api('DELETE', `/pages/${id}`);
    expect(await search('zucchini')).toEqual([]);
    await server.api('POST', '/trash/restore', { kind: 'page', id });
    expect(await search('zucchini')).toEqual(['Banana bread']);

    // folder scope
    await openFolder(page, server, 'Fruit');
    await page.keyboard.press('Control+k');
    await page.locator('.palette input').fill('ripe');
    await page.locator('.chip.scope').click();
    await page.waitForTimeout(450);
    expect(await page.locator('.palette .res b').allTextContents()).toEqual(['Mango recipes']);
    await page.keyboard.press('Escape');
  });

  test('search results page: Ctrl+Enter opens it with counts, type filters and sort', async ({ page }) => {
    await page.goto(server.url);
    await page.keyboard.press('Control+k');
    await page.locator('.palette input').fill('ripe');
    await page.waitForTimeout(450);
    await page.keyboard.press('Control+Enter');
    await expect(page).toHaveURL(/\/search\?q=ripe/);
    await expect(page.locator('.chip', { hasText: /^All \(\d+\)/ })).toBeVisible();
    await expect(page.locator('.list .res')).toHaveCount(2);
    await page.locator('.chip', { hasText: /^Folders/ }).click();
    await expect(page.locator('.list .res')).toHaveCount(0);
    await page.locator('.chip', { hasText: /^Pages/ }).click();
    await page.getByLabel('Sort results').selectOption('recent');
    await expect(page).toHaveURL(/sort=recent/);
    await expect(page.locator('.list .res')).toHaveCount(2);
  });

  test('export a page as Markdown and HTML (downloads) and a workspace ZIP; import Markdown back', async ({ page }) => {
    const id = await mk('Export me', 'Hello **world** export');
    await server.api('PUT', `/pages/${id}`, { version: 2, contentJson: JSON.stringify({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }, { type: 'text', text: ' & <b>tags</b>' }] }] }) });
    await openPage(page, server, 'Export me');
    await page.getByRole('button', { name: 'Page actions' }).click();
    const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Markdown/ }).click()]);
    expect(md.suggestedFilename()).toBe('Export me.md');
    const mdText = fs.readFileSync((await md.path())!, 'utf8');
    expect(mdText).toContain('# Export me');
    expect(mdText).toContain('## Section');
    expect(mdText).toContain('**bold** & \\<b>tags');
    await page.getByRole('button', { name: 'Page actions' }).click();
    const [html] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /HTML/ }).click()]);
    const htmlText = fs.readFileSync((await html.path())!, 'utf8');
    expect(htmlText).toContain('<strong>bold</strong>');
    expect(htmlText).toContain('&lt;b&gt;tags&lt;/b&gt;'); // escaped, not interpreted
    // PDF export opens the print view in a new tab
    await page.getByRole('button', { name: 'Page actions' }).click();
    const [popup] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('menuitem', { name: /PDF/ }).click()]);
    await popup.waitForURL(/format=pdf/); // the tab opens blank first, then navigates to the print view
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.locator('body')).toContainText('Save as PDF');
    await popup.close();

    await page.goto(`${server.url}/settings`);
    const [zip] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Export workspace/ }).click()]);
    expect(fs.statSync((await zip.path())!).size).toBeGreaterThan(200);

    // import: a Markdown file becomes a page with structure
    await page.goto(server.url);
    await page.locator('.spacer input[type=file]').setInputFiles({ name: 'roundtrip.md', mimeType: 'text/markdown', buffer: Buffer.from(mdText) });
    await expect(page.locator('.title')).toHaveValue('Export me');
    await expect(editor(page).locator('h2')).toHaveText('Section');
    await expect(editor(page).locator('strong')).toHaveText('bold');
  });
});
