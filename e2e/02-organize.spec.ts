import { expect, test } from '@playwright/test';
import { confirmDialog, ensureOpen, node, openPage } from './helpers';
import { TestServer } from './server';

const server = new TestServer();
test.beforeAll(() => server.start());
test.afterAll(() => server.cleanup());

const tree = () => server.api('GET', '/tree');
const byTitle = async (t: string) => (await tree()).pages.find((p: any) => p.title === t);
const byName = async (n: string) => (await tree()).folders.find((f: any) => f.name === n);
const rootFolderOrder = async () => (await tree()).folders.filter((f: any) => f.parentId === null).sort((a: any, b: any) => a.position - b.position).map((f: any) => f.name);

test.describe.serial('organising: drag & drop with a real mouse, move, duplicate, templates, trash', () => {
  test.beforeAll(async () => {
    await server.api('POST', '/folders', { name: 'Zone A' });
    await server.api('POST', '/folders', { name: 'Zone B' });
    const a = await byName('Zone A');
    await server.api('POST', '/pages', { title: 'Drag Me', folderId: a.id });
    await server.api('POST', '/pages', { title: 'Sibling Page', folderId: a.id });
  });

  test('drag a page onto a folder (middle of the row) moves it inside', async ({ page }) => {
    await openPage(page, server, 'Drag Me');
    await expect(node(page, 'Drag Me')).toBeVisible();
    await node(page, 'Drag Me').dragTo(node(page, 'Zone B'));
    await expect.poll(async () => (await byTitle('Drag Me')).folderId).toBe((await byName('Zone B')).id);
    await ensureOpen(page, 'Zone B');
    await expect(node(page, 'Drag Me')).toBeVisible();
  });

  test('drag a page onto another page nests it as a child', async ({ page }) => {
    await openPage(page, server, 'Sibling Page');
    await ensureOpen(page, 'Zone B');
    await node(page, 'Sibling Page').dragTo(node(page, 'Drag Me'));
    await expect.poll(async () => (await byTitle('Sibling Page')).parentPageId).toBe((await byTitle('Drag Me')).id);
    expect((await byTitle('Sibling Page')).folderId).toBeNull();
  });

  test('dropping on the top/bottom edge of a folder reorders it among its siblings', async ({ page }) => {
    await page.goto(server.url);
    const before = await rootFolderOrder();
    expect(before.indexOf('Zone A')).toBeLessThan(before.indexOf('Zone B'));
    // Zone B → above Zone A (top 25% of the row)
    await node(page, 'Zone B').dragTo(node(page, 'Zone A'), { targetPosition: { x: 60, y: 3 } });
    await expect.poll(async () => { const o = await rootFolderOrder(); return o.indexOf('Zone B') < o.indexOf('Zone A'); }).toBe(true);
    // and back below it (bottom 25%)
    await node(page, 'Zone B').dragTo(node(page, 'Zone A'), { targetPosition: { x: 60, y: 25 } });
    await expect.poll(async () => { const o = await rootFolderOrder(); return o.indexOf('Zone A') < o.indexOf('Zone B'); }).toBe(true);
  });

  test('invalid drops are refused: a folder onto a page, and a parent into its own child', async ({ page }) => {
    await openPage(page, server, 'Sibling Page');
    await ensureOpen(page, 'Zone B');
    await ensureOpen(page, 'Drag Me');
    const folderBefore = await byName('Zone B');
    await node(page, 'Zone B').dragTo(node(page, 'Sibling Page'));
    await page.waitForTimeout(400);
    expect((await byName('Zone B')).parentId).toBe(folderBefore.parentId); // unchanged
    await node(page, 'Drag Me').dragTo(node(page, 'Sibling Page')); // page into its own child
    await page.waitForTimeout(400);
    expect((await byTitle('Drag Me')).parentPageId).toBeNull();
  });

  test('Move to… moves a page to the workspace root and into another folder', async ({ page }) => {
    await openPage(page, server, 'Sibling Page');
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: /Move to/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Move to' });
    await dlg.locator('.dest', { hasText: 'Workspace root' }).click();
    await dlg.getByRole('button', { name: 'Move here' }).click();
    await expect.poll(async () => { const p = await byTitle('Sibling Page'); return [p.folderId, p.parentPageId]; }).toEqual([null, null]);
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: /Move to/ }).click();
    await dlg.locator('.dest', { hasText: 'Zone A' }).click();
    await dlg.getByRole('button', { name: 'Move here' }).click();
    await expect.poll(async () => (await byTitle('Sibling Page')).folderId).toBe((await byName('Zone A')).id);
    // a page cannot be moved into itself: its own row is disabled
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: /Move to/ }).click();
    await expect(dlg.locator('.dest', { hasText: 'Sibling Page' })).toBeDisabled();
    await page.keyboard.press('Escape');
  });

  test('duplicate creates an independent copy; templates create pages with variables', async ({ page }) => {
    const id = await openPage(page, server, 'Sibling Page');
    await server.api('PUT', `/pages/${id}`, { version: 1, contentJson: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'original body' }] }] }) });
    await page.reload();
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(page.locator('.title')).toHaveValue('Sibling Page (copy)');
    await expect(page.locator('.ProseMirror[aria-label="Page content"]')).toContainText('original body');
    expect((await tree()).pages.filter((p: any) => p.title.startsWith('Sibling Page')).length).toBe(2);

    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByRole('menuitem', { name: /New from template/ }).click();
    await page.locator('.tpl', { hasText: 'Daily note' }).click();
    await page.locator('.rename').press('Enter');
    const iso = new Date();
    const today = `${iso.getFullYear()}-${String(iso.getMonth() + 1).padStart(2, '0')}-${String(iso.getDate()).padStart(2, '0')}`;
    await expect(page.locator('.ProseMirror[aria-label="Page content"]')).toContainText(today);
    await expect(page.locator('.ProseMirror[aria-label="Page content"]')).not.toContainText('{{');
  });

  test('custom template: save a page as a template, create from it, delete it', async ({ page }) => {
    await openPage(page, server, 'Sibling Page');
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: /Save as template/ }).click();
    await page.getByRole('dialog', { name: 'Save as template' }).locator('input').fill('My E2E Template');
    await page.getByRole('button', { name: 'Save template' }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByRole('menuitem', { name: /New from template/ }).click();
    await expect(page.locator('.tpl', { hasText: 'My E2E Template' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete template My E2E Template' }).click({ force: true });
    await confirmDialog(page).getByRole('button', { name: 'Delete template' }).click();
    await expect(page.locator('.tpl', { hasText: 'My E2E Template' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('trash: deleting a folder subtree, restoring it, then deleting forever', async ({ page }) => {
    const f = await byName('Zone B');
    await server.api('POST', '/pages', { title: 'Inside Zone B', folderId: f.id });
    await page.goto(server.url);
    await node(page, 'Zone B').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Delete/ }).click();
    await confirmDialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(node(page, 'Zone B')).toHaveCount(0);
    await page.getByRole('link', { name: 'Trash' }).first().click();
    const row = page.locator('.list-row', { hasText: 'Zone B' });
    await expect(row).toContainText('inside');
    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(row).toHaveCount(0);
    await page.goto(server.url);
    await expect(node(page, 'Zone B')).toBeVisible();
    expect((await byTitle('Inside Zone B')).folderId).toBe(f.id); // subtree restored with it

    await server.api('POST', '/pages', { title: 'Disposable' });
    const d = await byTitle('Disposable');
    await server.api('DELETE', `/pages/${d.id}`);
    await page.goto(`${server.url}/trash`);
    const drow = page.locator('.list-row', { hasText: 'Disposable' });
    await drow.getByRole('button', { name: 'Delete forever' }).click();
    await expect(confirmDialog(page)).toContainText('cannot be undone');
    await confirmDialog(page).getByRole('button', { name: 'Delete forever' }).click();
    await expect(drow).toHaveCount(0);
    expect(server.sql("select count(*) from Page where title='Disposable'")).toBe('0'); // really gone
  });
});
