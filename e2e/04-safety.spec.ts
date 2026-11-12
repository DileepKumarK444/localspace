import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { confirmDialog, editor, node, openPage, status, goToEnd } from './helpers';
import { assertIntegrity } from './helpers2';
import { PNG, TestServer, doc } from './server';

const server = new TestServer();
test.beforeAll(() => server.start());
test.afterAll(() => server.cleanup());

const text = (id: string) => server.api('GET', `/pages/${id}`).then((p: any) => JSON.parse(p.contentJson).content.map((n: any) => (n.content ?? []).map((t: any) => t.text ?? '').join('')).join('\n'));
const mkPage = async (title: string, body: string) => {
  const p = await server.api('POST', '/pages', { title });
  await server.api('PUT', `/pages/${p.id}`, { version: 1, contentJson: doc(body) });
  return p.id as string;
};

test.describe.serial('safety: persistence, crashes, errors, conflicts, versions, backups', () => {
  test('data survives a graceful restart (content, search, attachments)', async ({ page }) => {
    const id = await mkPage('Durable', 'survives restarts');
    await fetch(`${server.url}/api/pages/${id}/attachments?filename=keep.png`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array(PNG) });
    await server.restart();
    await openPage(page, server, 'Durable');
    await expect(editor(page)).toContainText('survives restarts');
    expect((await server.api('GET', '/search?q=restarts')).pages.map((p: any) => p.title)).toContain('Durable');
    const att = (await server.api('GET', `/pages/${id}/attachments`))[0];
    expect((await fetch(server.url + att.url)).status).toBe(200);
    expect((await server.api('GET', '/tree')).pages.length).toBeGreaterThanOrEqual(10); // sample data still there
    assertIntegrity(server);
  });

  test('data survives a hard crash (SIGKILL right after a save)', async () => {
    const id = await mkPage('Crash test', 'written just before the crash');
    await server.kill9();
    await server.start();
    expect(await text(id)).toBe('written just before the crash');
    assertIntegrity(server);
  });

  test('saving while the server is down: error shown, nothing lost, automatic recovery', async ({ page }) => {
    const id = await mkPage('Offline edit', 'start');
    await openPage(page, server, 'Offline edit');
    await server.stop();
    await editor(page).click();
    await goToEnd(page);
    await page.keyboard.type(' typed-while-offline');
    await expect(status(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
    await expect(status(page)).toContainText(/retrying/i);
    await page.keyboard.type(' more');
    await expect(editor(page)).toContainText('typed-while-offline more'); // nothing discarded locally
    // the browser guards against closing a tab with unsaved work
    const draft = await page.evaluate((i) => localStorage.getItem(`localspace.draft.${i}`), id);
    expect(draft).toContain('typed-while-offline');
    await server.start(); // same port/data
    await expect(status(page)).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
    expect(await text(id)).toBe('start typed-while-offline more');
    await page.reload();
    await expect(editor(page)).toContainText('typed-while-offline more');
    expect(await page.evaluate((i) => localStorage.getItem(`localspace.draft.${i}`), id)).toBeNull(); // draft cleared once saved
  });

  test('closing a tab with unsaved changes warns; the draft is recovered next time', async ({ page, context }) => {
    const id = await mkPage('Draft recovery', 'base');
    await openPage(page, server, 'Draft recovery');
    await server.stop();
    await editor(page).click();
    await goToEnd(page);
    await page.keyboard.type(' unsaved-draft');
    await expect(status(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
    const dialogPromise = page.waitForEvent('dialog');
    await page.close({ runBeforeUnload: true });
    const dialog = await dialogPromise;
    expect(dialog.type()).toBe('beforeunload'); // the browser warns before discarding unsaved work
    await dialog.accept();
    await server.start();
    const page2 = await context.newPage();
    await openPage(page2, server, 'Draft recovery');
    await expect(page2.locator('.toast')).toContainText('Recovered unsaved changes');
    await expect(editor(page2)).toContainText('unsaved-draft');
    await expect(status(page2)).toHaveAttribute('data-state', 'saved');
    expect(await text(id)).toBe('base unsaved-draft');
  });

  test('two tabs editing the same page: the stale one is blocked, nothing is silently overwritten', async ({ page, context }) => {
    const id = await mkPage('Conflict page', 'original');
    await openPage(page, server, 'Conflict page');
    const other = await context.newPage();
    await openPage(other, server, 'Conflict page');
    await editor(page).click();
    await goToEnd(page);
    await page.keyboard.type(' from-tab-A');
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    await editor(other).click();
    await goToEnd(other);
    await other.keyboard.type(' from-tab-B');
    await expect(status(other)).toHaveAttribute('data-state', 'conflict');
    await expect(other.getByRole('alert')).toContainText('changed elsewhere');
    expect(await text(id)).toBe('original from-tab-A'); // server untouched by the stale tab
    await expect(editor(other)).toContainText('from-tab-B'); // its edits are kept on screen
    await other.getByRole('button', { name: /Load latest/ }).click();
    await expect(editor(other)).toContainText('from-tab-A');
    await expect(editor(other)).not.toContainText('from-tab-B');

    // second scenario: choose to overwrite deliberately
    await page.reload();
    await editor(page).click();
    await goToEnd(page);
    await page.keyboard.type(' A2');
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    await editor(other).click();
    await goToEnd(other);
    await other.keyboard.type(' B2');
    await expect(status(other)).toHaveAttribute('data-state', 'conflict');
    await other.getByRole('button', { name: 'Overwrite with my version' }).click();
    await expect(status(other)).toHaveAttribute('data-state', 'saved');
    expect(await text(id)).toContain('B2');
    await other.close();
  });

  test('version history through the UI: save a version, change the page, restore, and undo the restore', async ({ page }) => {
    const id = await mkPage('History page', 'first');
    await openPage(page, server, 'History page');
    await page.getByRole('button', { name: 'Version history' }).click();
    await page.getByRole('button', { name: 'Save version' }).click();
    const saveDlg = page.getByRole('dialog', { name: 'Save a version' });
    await saveDlg.locator('input').fill('Before changes');
    await saveDlg.getByRole('button', { name: 'Save version' }).click();
    await expect(page.locator('.v-item', { hasText: 'Before changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Close history' }).click();
    await editor(page).click();
    await goToEnd(page);
    await page.keyboard.type(' changed');
    await expect(status(page)).toHaveAttribute('data-state', 'saved');
    expect(await text(id)).toBe('first changed');
    await page.getByRole('button', { name: 'Version history' }).click();
    await page.locator('.v-item', { hasText: 'Before changes' }).click();
    await expect(page.locator('.v-preview')).toContainText('first');
    await expect(page.locator('.v-preview')).not.toContainText('changed');
    await page.getByRole('button', { name: 'Restore this version' }).click();
    await confirmDialog(page).getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.locator('.v-item', { hasText: 'Before restore' })).toBeVisible();
    expect(await text(id)).toBe('first');
    // undo
    await page.locator('.v-item', { hasText: 'Before restore' }).click();
    await page.getByRole('button', { name: 'Restore this version' }).click();
    await confirmDialog(page).getByRole('button', { name: 'Restore', exact: true }).click();
    await expect.poll(() => text(id)).toBe('first changed');
  });

  test('backup & restore through Settings, including undoing the restore', async ({ page }) => {
    const keep = await mkPage('Keep me', 'in the backup');
    await page.goto(`${server.url}/settings`);
    const before = await page.locator('.list-row').count();
    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.locator('.list-row')).toHaveCount(before + 1);
    const after = await mkPage('Added after backup', 'not in the backup');
    await page.locator('.list-row').first().getByRole('button', { name: 'Restore' }).click();
    await expect(confirmDialog(page)).toContainText('safety backup');
    await confirmDialog(page).getByRole('button', { name: 'Restore backup' }).click();
    await expect(page).toHaveURL(/\/page\//, { timeout: 20_000 }); // restore reloads the app, Home redirects to a page
    expect((await server.api('GET', `/pages/${keep}`)).title).toBe('Keep me');
    await expect(server.api('GET', `/pages/${after}`)).rejects.toThrow(/404/);
    expect((await server.api('GET', '/search?q=backup')).pages.map((p: any) => p.title)).toContain('Keep me'); // index rebuilt
    assertIntegrity(server);
    // undo using the safety backup (newest)
    await page.goto(`${server.url}/settings`);
    await page.locator('.list-row').first().getByRole('button', { name: 'Restore' }).click();
    await confirmDialog(page).getByRole('button', { name: 'Restore backup' }).click();
    await expect(page).toHaveURL(/\/page\//, { timeout: 20_000 }); // restore reloads the app, Home redirects to a page
    expect((await server.api('GET', `/pages/${after}`)).title).toBe('Added after backup');
    assertIntegrity(server);
  });

  test('backups hold attachments too, and a restore never deletes files', async () => {
    const id = await mkPage('With file', 'x');
    await fetch(`${server.url}/api/pages/${id}/attachments?filename=bk.png`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: new Uint8Array(PNG) });
    const b = await server.api('POST', '/backups');
    const dir = path.join(server.dir, 'backups', b.name);
    expect(fs.existsSync(path.join(dir, 'localspace.db'))).toBe(true);
    const files = (fs.readdirSync(path.join(dir, 'attachments'), { recursive: true }) as string[]).filter((f) => /\.png$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    await server.api('POST', '/backups/restore', { name: b.name });
    const att = (await server.api('GET', `/pages/${id}/attachments`))[0];
    expect((await fetch(server.url + att.url)).status).toBe(200);
    // a backup that is not a SQLite database is refused and nothing changes
    fs.mkdirSync(path.join(server.dir, 'backups', 'backup-bad'), { recursive: true });
    fs.writeFileSync(path.join(server.dir, 'backups', 'backup-bad', 'localspace.db'), 'this is not a database');
    await expect(server.api('POST', '/backups/restore', { name: 'backup-bad' })).rejects.toThrow(/400/);
    expect((await server.api('GET', `/pages/${id}`)).title).toBe('With file');
    assertIntegrity(server);
  });

  test('concurrent writers never corrupt data: 40 parallel saves/creates/moves keep the database consistent', async () => {
    const folder = await server.api('POST', '/folders', { name: 'Stress' });
    const pages = await Promise.all(Array.from({ length: 10 }, (_, i) => server.api('POST', '/pages', { title: `Stress ${i}`, folderId: folder.id })));
    const ops: Promise<unknown>[] = [];
    for (const [i, p] of pages.entries()) {
      ops.push(server.api('PUT', `/pages/${p.id}`, { version: 1, contentJson: doc(`stress body ${i}`) }));
      ops.push(server.api('POST', `/pages/${p.id}/favorite`).catch(() => server.api('PUT', `/pages/${p.id}/favorite`)));
      ops.push(server.api('POST', '/move', { kind: 'page', id: p.id, parent: { kind: 'folder', id: folder.id }, beforeId: pages[(i + 3) % 10].id }));
      ops.push(server.api('PATCH', `/pages/${p.id}`, { title: `Stress renamed ${i}` }));
    }
    const settled = await Promise.allSettled(ops);
    const failures = settled.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));
    if (failures.length) console.log('SERVER-LOG-TAIL', server.log.split('\n').filter((l) => /rror|BUSY|locked|timeout|Timed/i.test(l)).slice(-12).join('\n'));
    expect(failures.filter((f) => !/404/.test(f))).toEqual([]);
    const tree = await server.api('GET', '/tree');
    const inFolder = tree.pages.filter((p: any) => p.folderId === folder.id);
    expect(inFolder).toHaveLength(10);
    expect(new Set(inFolder.map((p: any) => p.position)).size).toBe(10); // positions stay unique after concurrent reordering
    assertIntegrity(server);
  });
});
