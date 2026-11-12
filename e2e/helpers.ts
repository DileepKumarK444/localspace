import { expect, type Page } from '@playwright/test';
import type { TestServer } from './server';

export const node = (page: Page, label: string) => page.locator('[role=tree] .node').filter({ has: page.locator('.label', { hasText: new RegExp(`^${label}$`) }) });
export const status = (page: Page) => page.getByTestId('save-status');
export const editor = (page: Page) => page.locator('.ProseMirror[aria-label="Page content"]');
export const confirmDialog = (page: Page) => page.getByRole('alertdialog');

export async function openPage(page: Page, server: TestServer, title: string) {
  const p = (await server.api('GET', '/tree')).pages.find((x: any) => x.title === title);
  if (!p) throw new Error(`no page titled ${title}`);
  await page.goto(`${server.url}/page/${p.id}`);
  await expect(page.locator('.title')).toHaveValue(title);
  return p.id as string;
}
export async function openFolder(page: Page, server: TestServer, name: string) {
  const f = (await server.api('GET', '/tree')).folders.find((x: any) => x.name === name);
  await page.goto(`${server.url}/folder/${f.id}`);
  return f.id as string;
}
/** Expands a tree item only if it is collapsed. */
export async function ensureOpen(page: Page, label: string) {
  const item = page.locator('[role=treeitem]').filter({ has: page.locator('> .node .label', { hasText: new RegExp(`^${label}$`) }) }).first();
  if ((await item.getAttribute('aria-expanded')) === 'false') await node(page, label).locator('.chev').click();
}
