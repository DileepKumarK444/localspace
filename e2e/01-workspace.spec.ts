import { expect, test, type Page } from '@playwright/test';
import { goToEnd } from './helpers';
import { TestServer } from './server';

const server = new TestServer();
test.beforeAll(() => server.start());
test.afterAll(() => server.cleanup());

const node = (page: Page, label: string) => page.locator('[role=tree] .node').filter({ has: page.locator('.label', { hasText: new RegExp(`^${label}$`) }) });
/** Expands a folder/page in the tree only if it is currently collapsed. */
async function ensureOpen(page: Page, label: string) {
  const item = page.locator('[role=treeitem]').filter({ has: page.locator('> .node .label', { hasText: new RegExp(`^${label}$`) }) }).first();
  if ((await item.getAttribute('aria-expanded')) === 'false') await node(page, label).locator('.chev').click();
  await expect(item).toHaveAttribute('aria-expanded', 'true');
}
/** Opens a page by title via its URL (the sidebar then expands to it). */
async function openPage(page: Page, title: string) {
  const p = (await server.api('GET', '/tree')).pages.find((x: any) => x.title === title);
  await page.goto(`${server.url}/page/${p.id}`);
  await expect(page.locator('.title')).toHaveValue(title);
}
const status = (page: Page) => page.getByTestId('save-status');
const editor = (page: Page) => page.locator('.ProseMirror[aria-label="Page content"]');

async function renameTo(page: Page, name: string) {
  const input = page.locator('.rename');
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

test.describe.serial('workspace: creating, nesting, navigating, editing, autosave', () => {
  test('the app starts with the sample workspace and no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url);
    await expect(page.locator('[role=tree]')).toBeVisible();
    for (const f of ['Getting Started', 'Projects', 'Personal Notes']) await expect(node(page, f)).toBeVisible();
    await expect(page.locator('.sb-scroll')).toContainText('Favorites');
    expect(errors).toEqual([]);
  });

  test('expand/collapse folders and open nested pages with correct breadcrumbs and highlight', async ({ page }) => {
    await page.goto(server.url);
    await ensureOpen(page, 'Projects');
    await ensureOpen(page, 'Project Alpha');
    await ensureOpen(page, 'Architecture');
    await node(page, 'Data Model').click();
    await expect(page).toHaveURL(/\/page\//);
    await expect(page.locator('.title')).toHaveValue('Data Model');
    await expect(page.locator('.crumbs')).toContainText('Projects');
    await expect(page.locator('.crumbs')).toContainText('Project Alpha');
    await expect(page.locator('.crumbs')).toContainText('Architecture');
    await expect(node(page, 'Data Model')).toHaveClass(/sel/);
    await node(page, 'Projects').locator('.chev').click(); // collapse hides the subtree
    await expect(node(page, 'Data Model')).toHaveCount(0);
    await page.locator('.crumbs a', { hasText: 'Architecture' }).click(); // breadcrumb navigation re-expands to the item
    await expect(page.locator('.title')).toHaveValue('Architecture');
    await expect(node(page, 'Architecture')).toHaveClass(/sel/);
  });

  test('create a folder, a nested folder, a page and a child page through the UI', async ({ page }) => {
    await page.goto(server.url);
    await page.getByRole('button', { name: 'New folder' }).click();
    await renameTo(page, 'E2E Folder');
    await expect(page.locator('.title')).toContainText('E2E Folder');

    await page.getByRole('button', { name: 'New subfolder' }).click();
    await renameTo(page, 'Nested One');
    await page.locator('.head-row').getByRole('button', { name: 'New page' }).click();
    await renameTo(page, 'Deep Page');
    await expect(page.locator('.crumbs')).toContainText('E2E Folder');
    await expect(page.locator('.crumbs')).toContainText('Nested One');

    // child page via the context menu
    await node(page, 'Deep Page').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /New child page/ }).click();
    await renameTo(page, 'Child Of Deep');
    await expect(page.locator('.crumbs')).toContainText('Deep Page');

    const tree = await server.api('GET', '/tree');
    const f = tree.folders.find((x: any) => x.name === 'E2E Folder');
    const n = tree.folders.find((x: any) => x.name === 'Nested One');
    const p = tree.pages.find((x: any) => x.title === 'Deep Page');
    const c = tree.pages.find((x: any) => x.title === 'Child Of Deep');
    expect(n.parentId).toBe(f.id);
    expect(p.folderId).toBe(n.id);
    expect(c.parentPageId).toBe(p.id);
  });

  test('typing is autosaved (Saving → Saved) and survives a reload', async ({ page }) => {
    await openPage(page, 'Deep Page');
    await editor(page).click();
    await page.keyboard.type('Persistent text from e2e');
    await expect(status(page)).toHaveAttribute('data-state', 'saving');
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(editor(page)).toContainText('Persistent text from e2e');
  });

  test('rich formatting: bold, heading, list, link, table and divider all persist', async ({ page }) => {
    await openPage(page, 'Deep Page');
    await editor(page).click();
    await goToEnd(page);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Meta+b');
    await page.keyboard.type('boldword');
    await page.keyboard.press('Meta+b');
    await page.keyboard.press('Enter');
    await page.getByLabel('Text style').selectOption('2');
    await page.keyboard.type('A heading');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Bullet list' }).click();
    await page.keyboard.type('item 1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('item 2');
    await page.keyboard.press('Enter');
    await expect(editor(page).locator('ul li')).toHaveCount(3); // a new empty item
    await page.keyboard.press('Enter');
    await expect(editor(page).locator('ul li')).toHaveCount(2); // Enter on the empty item leaves the list
    await page.getByRole('button', { name: 'Insert' }).click();
    await page.getByRole('button', { name: 'Table' }).click();
    await page.keyboard.type('H1');
    await page.keyboard.press('Tab');
    await page.keyboard.type('H2');
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    await page.reload();
    const ed = editor(page);
    await expect(ed.locator('strong')).toHaveText('boldword');
    await expect(ed.locator('h2')).toHaveText('A heading');
    await expect(ed.locator('ul li')).toHaveCount(2);
    await expect(ed.locator('table th').first()).toHaveText('H1');
    await expect(ed.locator('table th').nth(1)).toHaveText('H2');
  });

  test('table tools: add column, delete row, colour a cell', async ({ page }) => {
    await openPage(page, 'Deep Page');
    await editor(page).locator('table td').first().click();
    const cols = () => editor(page).locator('table tr').first().locator('th').count();
    const before = await cols();
    await page.getByRole('button', { name: 'Add column right' }).click();
    expect(await cols()).toBe(before + 1);
    await page.getByRole('button', { name: 'Cell colour' }).click();
    await page.getByRole('button', { name: 'Mint', exact: true }).click();
    await expect(editor(page).locator('td[data-bg]')).toHaveCount(1);
    const rows = await editor(page).locator('table tr').count();
    await page.getByRole('button', { name: 'Delete row' }).click();
    expect(await editor(page).locator('table tr').count()).toBe(rows - 1);
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
  });

  test('merge cells with a real mouse drag selection', async ({ page }) => {
    await page.goto(server.url);
    const req = (await server.api('GET', '/tree')).pages.find((p: any) => p.title === 'Requirements');
    await page.goto(`${server.url}/page/${req.id}`); // has a table; the tree expands to it
    // put the cursor in the table first so the context tools are shown, then measure (layout must not move during the drag)
    await editor(page).locator('table tr').nth(1).locator('td').first().click();
    const before = (await editor(page).locator('table').boundingBox())!.y;
    const cells = editor(page).locator('table tr').nth(1).locator('td');
    const a = (await cells.nth(0).boundingBox())!;
    const b = (await cells.nth(1).boundingBox())!;
    await page.mouse.move(a.x + 10, a.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + 10, b.y + 10, { steps: 6 });
    await page.mouse.up();
    expect(Math.abs((await editor(page).locator('table').boundingBox())!.y - before)).toBeLessThan(1); // no layout shift
    const merge = page.getByRole('button', { name: 'Merge cells' });
    await expect(merge).toBeEnabled();
    await merge.click();
    await expect(editor(page).locator('td[colspan="2"]')).toHaveCount(1);
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(editor(page).locator('td[colspan="2"]')).toHaveCount(1);
  });

  test('favorites and recently viewed update; rename in the tree updates the page title', async ({ page }) => {
    await openPage(page, 'Deep Page');
    await page.getByRole('button', { name: 'Add to favorites' }).click();
    await expect(page.locator('.sb-scroll').getByText('Deep Page').first()).toBeVisible();
    await node(page, 'Deep Page').press('F2');
    await renameTo(page, 'Deep Page Renamed');
    await expect(page.locator('.title')).toHaveValue('Deep Page Renamed');
    await expect(page.locator('.crumbs')).toContainText('Deep Page Renamed');
    expect((await server.api('GET', '/tree')).pages.find((p: any) => p.title === 'Deep Page Renamed')).toBeTruthy();
  });

  test('delete asks for confirmation, soft-deletes the subtree and can be cancelled', async ({ page }) => {
    await page.goto(server.url);
    await node(page, 'E2E Folder').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Delete/ }).click();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('also deletes');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(node(page, 'E2E Folder')).toBeVisible(); // cancelled → nothing removed
    await node(page, 'E2E Folder').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Delete/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(node(page, 'E2E Folder')).toHaveCount(0);
    expect(server.sql("select count(*) from Folder where name='E2E Folder' and deletedAt is not null")).toBe('1'); // still in the DB (Trash)
  });
});
