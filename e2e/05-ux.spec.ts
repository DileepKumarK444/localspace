import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { confirmDialog, editor, node, openFolder, openPage, status } from './helpers';
import { TestServer } from './server';

const server = new TestServer();
test.beforeAll(async () => {
  await server.start();
  await server.api('POST', '/folders', { name: 'UX Folder' });
});
test.afterAll(() => server.cleanup());

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

test.describe('theme', () => {
  test('a saved dark theme is applied before the first paint, and Alt+T / Settings switch and persist it', async ({ page }) => {
    await page.addInitScript(() => { if (!localStorage.getItem('localspace.theme')) localStorage.setItem('localspace.theme', 'dark'); });
    // With the app's JavaScript blocked, the dark theme must already be on the page: it comes from the tiny inline script, so there is no light flash.
    await page.route('**/assets/*.js', (r) => r.abort());
    await page.goto(server.url);
    expect(await theme(page)).toBe('dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(29, 33, 37)');
    await page.unroute('**/assets/*.js');
    await page.goto(server.url);
    await expect(page.locator('.sidebar')).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(29, 33, 37)');
    await page.goto(`${server.url}/settings`);
    await page.getByRole('radio', { name: 'Light' }).click();
    expect(await theme(page)).toBe('light');
    await page.reload();
    expect(await theme(page)).toBe('light');
    await page.keyboard.press('Alt+t'); // light → dark
    expect(await theme(page)).toBe('dark');
  });

  for (const mode of ['light', 'dark'] as const) {
    test(`text has readable contrast in the ${mode} theme (editor, sidebar, toolbar, muted text)`, async ({ page }) => {
      await page.addInitScript((m) => localStorage.setItem('localspace.theme', m), mode);
      await openPage(page, server, (await server.api('GET', '/tree')).pages[0].title);
      const ratios = await page.evaluate(() => {
        const lum = (c: string) => { const m = c.match(/\d+(\.\d+)?/g)!.map(Number); const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const bgOf = (el: Element): string => { let e: Element | null = el; while (e) { const c = getComputedStyle(e).backgroundColor; if (!/rgba?\(\s*0,\s*0,\s*0,\s*0\)|transparent/.test(c)) return c; e = e.parentElement; } return 'rgb(255,255,255)'; };
        const ratio = (sel: string) => { const el = document.querySelector(sel)!; const a = lum(getComputedStyle(el).color), b = lum(bgOf(el)); const [hi, lo] = a > b ? [a, b] : [b, a]; return (hi + 0.05) / (lo + 0.05); };
        return { editor: ratio('.ProseMirror p'), title: ratio('.title'), sidebar: ratio('.sidebar .node .label'), muted: ratio('.meta span'), crumbs: ratio('.crumbs .cur') };
      });
      for (const [k, v] of Object.entries(ratios)) expect(v, `${k} contrast in ${mode}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe('keyboard', () => {
  test('global shortcuts work with real key presses', async ({ page }) => {
    await openFolder(page, server, 'UX Folder');
    await page.keyboard.press('Alt+b');
    await expect(page.locator('.sidebar')).toHaveCount(0);
    await page.keyboard.press('Alt+b');
    await expect(page.locator('.sidebar')).toBeVisible();

    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible();
    await expect(page.locator('.palette input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.palette')).toHaveCount(0);

    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
    await page.keyboard.press('Control+/');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Control+/');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);

    await page.keyboard.press('Alt+n'); // new page inside the open folder, ready to rename
    await expect(page.locator('.rename')).toBeFocused();
    await page.locator('.rename').fill('Made by shortcut');
    await page.keyboard.press('Enter');
    await expect(page.locator('.title')).toHaveValue('Made by shortcut');
    await page.keyboard.press('Alt+Shift+n');
    await expect(page.locator('.rename')).toBeFocused();
    await page.keyboard.press('Escape');
  });

  test('page shortcuts: save, favorite, duplicate and history; "?" is ignored while typing', async ({ page }) => {
    await openPage(page, server, 'Made by shortcut');
    await editor(page).click();
    await page.keyboard.type('what? really?'); // '?' typed in the editor must not open the help dialog
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect(page.locator('.toasts')).toContainText('Saved');
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    await page.keyboard.press('Alt+f');
    await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
    await page.keyboard.press('Alt+h');
    await expect(page.getByRole('dialog', { name: 'Version history' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Version history' })).toHaveCount(0);
    await page.keyboard.press('Alt+d');
    await expect(page.locator('.title')).toHaveValue('Made by shortcut (copy)');
  });

  test('page tree: arrow keys move/expand/collapse, F2 renames, Delete asks to confirm', async ({ page }) => {
    await page.goto(server.url);
    await node(page, 'UX Folder').focus();
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement?.className)).toContain('node');
    await node(page, 'UX Folder').focus();
    await page.keyboard.press('ArrowRight'); // expand
    await expect(page.locator('[role=treeitem]').filter({ has: page.locator('> .node .label', { hasText: /^UX Folder$/ }) })).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowRight'); // into the first child (the subfolder made earlier; folders sort before pages)
    await expect(node(page, 'New folder')).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // back to the parent
    await expect(node(page, 'UX Folder')).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // collapse
    await expect(node(page, 'Made by shortcut')).toHaveCount(0);
    await page.keyboard.press('F2');
    await expect(page.locator('.rename')).toBeFocused();
    await page.keyboard.press('Escape');
    await node(page, 'UX Folder').focus();
    await page.keyboard.press('Delete');
    await expect(confirmDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmDialog(page)).toHaveCount(0);
  });
});

test.describe('sidebar sections', () => {
  test('Favorites, Recently viewed and Pages fold open and closed, remember their state, and never hide a filter match', async ({ page }) => {
    const arch = (await server.api('GET', '/tree')).pages.find((p: any) => p.title === 'Architecture');
    await page.goto(`${server.url}/page/${arch.id}`);
    const fav = page.locator('.sb-scroll');
    const toggle = (name: string) => page.locator('.sec-toggle', { hasText: new RegExp(`^${name}`) });
    await expect(toggle('Favorites')).toHaveAttribute('aria-expanded', 'true');
    await expect(fav.locator('.node', { hasText: 'Introduction' }).first()).toBeVisible(); // a sample favorite

    // Favorites: collapse hides the list and shows a count badge
    await toggle('Favorites').click();
    await expect(toggle('Favorites')).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle('Favorites').locator('.sec-count')).toHaveText(String((await server.api('GET', '/tree')).favorites.length));
    await expect(page.locator('.sb-scroll .node', { hasText: 'Star a page' })).toHaveCount(0);
    // Recently viewed
    await toggle('Recently viewed').click();
    await expect(toggle('Recently viewed')).toHaveAttribute('aria-expanded', 'false');
    // Pages: the whole tree disappears (but the open page stays open in the editor)
    await toggle('Pages').click();
    await expect(page.locator('[role=tree]')).toBeHidden();
    await expect(page.locator('.title')).toHaveValue('Architecture');
    // typing in the filter reveals matches even while Pages is collapsed
    await page.getByLabel('Filter pages').fill('Data Model');
    await expect(page.locator('[role=tree]')).toBeVisible();
    await expect(node(page, 'Data Model')).toBeVisible();
    await page.getByLabel('Filter pages').fill('');
    await expect(page.locator('[role=tree]')).toBeHidden();

    // state survives a reload
    await page.reload();
    await expect(toggle('Favorites')).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle('Recently viewed')).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle('Pages')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[role=tree]')).toBeHidden();

    // reopen all
    for (const n of ['Favorites', 'Recently viewed', 'Pages']) await toggle(n).click();
    await expect(page.locator('[role=tree]')).toBeVisible();
    await expect(node(page, 'Architecture')).toBeVisible();
    // the "new folder" button still works from the Pages header and keyboard toggling works
    await toggle('Pages').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[role=tree]')).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(page.locator('[role=tree]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New folder' })).toBeVisible();
  });
});

test.describe('phone-sized screens', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('every screen fits the width; the sidebar is a drawer that closes after navigating; editing works', async ({ page }) => {
    const noOverflow = async (label: string) => {
      const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, main: (document.querySelector('.main') as HTMLElement | null)?.scrollWidth ?? 0, win: innerWidth }));
      expect(w.doc, `${label}: page wider than screen`).toBeLessThanOrEqual(w.win);
      expect(w.main, `${label}: content wider than screen`).toBeLessThanOrEqual(w.win);
    };
    const arch = (await server.api('GET', '/tree')).pages.find((p: any) => p.title === 'Architecture');
    await page.goto(`${server.url}/page/${arch.id}`);
    await expect(page.locator('.title')).toBeVisible();
    await expect(page.locator('.sidebar')).toHaveCount(0); // closed by default
    await noOverflow('page');
    await page.getByRole('button', { name: 'Show sidebar' }).click();
    await expect(page.locator('.sidebar')).toBeVisible();
    const box = (await page.locator('.sidebar').boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(375);
    await node(page, 'Requirements').click(); // visible because the tree expanded to Architecture's folder
    await expect(page.locator('.title')).toHaveValue('Requirements');
    await expect(page.locator('.sidebar')).toHaveCount(0); // closed after navigating
    await editor(page).click();
    await page.keyboard.type(' mobile typing');
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();

    for (const [label, url] of [['home', '/'], ['settings', '/settings'], ['activity', '/activity'], ['trash', '/trash'], ['search', '/search?q=architecture']] as const) {
      await page.goto(server.url + url);
      await page.waitForTimeout(500);
      await noOverflow(label);
    }
    await openFolder(page, server, 'UX Folder');
    await noOverflow('folder');
    await page.getByRole('button', { name: 'Search everything' }).click();
    const pal = (await page.locator('.palette').boundingBox())!;
    expect(pal.x).toBeGreaterThanOrEqual(0);
    expect(pal.x + pal.width).toBeLessThanOrEqual(375);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByRole('menuitem', { name: /New from template/ }).click();
    const dlg = (await page.locator('.dialog').boundingBox())!;
    expect(dlg.x + dlg.width).toBeLessThanOrEqual(375);
  });
});

test.describe('accessibility (axe)', () => {
  const audit = async (page: Page, label: string) => {
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target?.join(' ')}`), JSON.stringify(bad.map((v) => v.help))).toEqual([]);
  };
  for (const mode of ['light', 'dark'] as const) {
    test(`no serious/critical WCAG A/AA violations on the main screens (${mode})`, async ({ page }) => {
      await page.addInitScript((m) => localStorage.setItem('localspace.theme', m), mode);
      const arch = (await server.api('GET', '/tree')).pages.find((p: any) => p.title === 'Architecture');
      await page.goto(`${server.url}/page/${arch.id}`);
      await expect(page.locator('.ProseMirror')).toBeVisible();
      await audit(page, `page/${mode}`);
      await page.goto(`${server.url}/settings`);
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await audit(page, `settings/${mode}`);
      await page.goto(`${server.url}/activity`);
      await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
      await audit(page, `activity/${mode}`);
      await page.goto(`${server.url}/search?q=architecture`);
      await expect(page.locator('.list .res').first()).toBeVisible();
      await audit(page, `search/${mode}`);
      await page.goto(`${server.url}/page/${arch.id}`);
      await page.keyboard.press('Control+k');
      await page.locator('.palette input').fill('auto');
      await expect(page.locator('.palette .res').first()).toBeVisible();
      await audit(page, `palette/${mode}`);
    });
  }

  test('dialogs, menus and the history drawer have no serious/critical violations', async ({ page }) => {
    const arch = (await server.api('GET', '/tree')).pages.find((p: any) => p.title === 'Architecture');
    await page.goto(`${server.url}/page/${arch.id}`);
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await page.keyboard.press('Control+/');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await audit(page, 'shortcuts dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Version history' }).click();
    await expect(page.getByRole('dialog', { name: 'Version history' })).toBeVisible();
    await audit(page, 'history drawer');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByRole('menuitem', { name: /New from template/ }).click();
    await expect(page.getByRole('dialog', { name: 'New page from template' })).toBeVisible();
    await audit(page, 'template dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Page actions' }).click();
    await page.getByRole('menuitem', { name: /Move to/ }).click();
    await expect(page.getByRole('dialog', { name: 'Move to' })).toBeVisible();
    await audit(page, 'move dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Page actions' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await audit(page, 'page menu');
  });
});
