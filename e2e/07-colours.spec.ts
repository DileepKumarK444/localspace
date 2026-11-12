import { expect, test, type Page } from '@playwright/test';
import { editor, node, openPage, status } from './helpers';
import { TestServer } from './server';

const server = new TestServer();
test.beforeAll(() => server.start());
test.afterAll(() => server.cleanup());

const iconColor = (page: Page, label: string) => node(page, label).locator('.nico').evaluate((el) => getComputedStyle(el).color);
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };

/** Selects the first paragraph's text (via a DOM range, so it behaves the same on every OS). */
async function selectFirstLine(page: Page) {
  await editor(page).locator('p').first().click({ position: { x: 8, y: 8 } });
  await page.evaluate(() => {
    const p = document.querySelector('.ProseMirror p')!;
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  });
}

test.describe.serial('colours: folder/page icons and editor colours', () => {
  test('pick an icon colour for a folder and a page from the context menu; it persists across reloads', async ({ page }) => {
    await page.goto(server.url);
    const before = await iconColor(page, 'Projects');
    await node(page, 'Projects').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Icon colour/ }).click();
    await page.getByRole('dialog', { name: 'Icon colour' }).getByRole('button', { name: 'Red', exact: true }).click();
    await expect.poll(() => iconColor(page, 'Projects')).toBe(rgb('#e5484d'));
    expect(before).not.toBe(rgb('#e5484d'));
    expect((await server.api('GET', '/tree')).folders.find((f: any) => f.name === 'Projects').color).toBe('#e5484d');
    await page.reload();
    await expect.poll(() => iconColor(page, 'Projects')).toBe(rgb('#e5484d'));

    // a page, via its ⋯ menu, using the custom colour picker
    await openPage(page, server, 'Architecture');
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: /Icon colour/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Icon colour' });
    await dlg.getByLabel('Custom colour hex code').fill('#12a594');
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await expect.poll(() => iconColor(page, 'Architecture')).toBe(rgb('#12a594'));
    expect((await server.api('GET', '/tree')).pages.find((p: any) => p.title === 'Architecture').color).toBe('#12a594');
    // the selected row keeps its chosen colour
    await expect(node(page, 'Architecture')).toHaveClass(/sel/);
    expect(await iconColor(page, 'Architecture')).toBe(rgb('#12a594'));
  });

  test('reset to the default colour, and the colour shows in favorites/recents and folder cards', async ({ page }) => {
    await page.goto(server.url);
    const arch = (await server.api('GET', '/tree')).pages.find((p: any) => p.title === 'Architecture');
    await page.goto(`${server.url}/page/${arch.id}`);
    // favorites list (Architecture is a sample favorite) uses the same colour
    const fav = page.locator('.sb-scroll .node', { hasText: 'Architecture' }).first().locator('.nico');
    expect(await fav.evaluate((el) => getComputedStyle(el).color)).toBe(rgb('#12a594'));
    // folder page: coloured cards and header icon
    const projects = (await server.api('GET', '/tree')).folders.find((f: any) => f.name === 'Projects');
    await page.goto(`${server.url}/folder/${projects.id}`);
    expect(await page.locator('.title svg').evaluate((el) => getComputedStyle(el).color)).toBe(rgb('#e5484d'));
    await page.getByRole('button', { name: 'Icon colour' }).click();
    await page.getByRole('dialog', { name: 'Icon colour' }).getByRole('button', { name: 'Default colour' }).click();
    await expect.poll(async () => (await server.api('GET', '/tree')).folders.find((f: any) => f.name === 'Projects').color).toBeNull();
  });

  test('editor: a wide palette plus a custom colour for text, highlight and table cells', async ({ page }) => {
    const cell = (t: string) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
    const made = await server.api('POST', '/pages', { title: 'Colour test' });
    await server.api('PUT', `/pages/${made.id}`, { version: 1, contentJson: JSON.stringify({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'colour me' }] },
      { type: 'table', content: [{ type: 'tableRow', content: [cell('a'), cell('b')] }, { type: 'tableRow', content: [cell('c'), cell('d')] }] },
    ] }) });
    const id = await openPage(page, server, 'Colour test');
    await selectFirstLine(page);
    await page.getByRole('button', { name: 'Text colour' }).click();
    const swatches = await page.locator('.pop-panel .swatch').count();
    expect(swatches).toBeGreaterThanOrEqual(36); // far more than the original 7
    await page.getByLabel('Custom colour hex code').fill('#ff00aa');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(editor(page).locator('span[style*="color: rgb(255, 0, 170)"]')).toHaveText('colour me');
    // pick from the palette for the highlight
    await selectFirstLine(page);
    await page.getByRole('button', { name: 'Highlight' }).click();
    await page.locator('.pop-panel .swatch').nth(5).click();
    await expect(editor(page).locator('mark')).toHaveCount(1);
    // custom cell colour in a table
    await editor(page).locator('table td').first().click();
    await page.getByRole('button', { name: 'Cell colour' }).click();
    await page.getByLabel('Custom colour hex code').fill('#aaddff');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(editor(page).locator('td[data-bg="#aaddff"]')).toHaveCount(1);
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    // persisted, and recently used colours are offered again
    await page.reload();
    await expect(editor(page).locator('span[style*="color: rgb(255, 0, 170)"]')).toHaveText('colour me');
    await expect(editor(page).locator('td[data-bg="#aaddff"]')).toHaveCount(1);
    await editor(page).locator('span[style*="rgb(255, 0, 170)"]').click();
    await page.getByRole('button', { name: 'Text colour' }).click();
    await expect(page.getByRole('button', { name: 'Recent #ff00aa' })).toBeVisible();
    expect(JSON.parse((await server.api('GET', `/pages/${id}`)).contentJson).content.some((n: any) => JSON.stringify(n).includes('#ff00aa'))).toBe(true);
  });
});
