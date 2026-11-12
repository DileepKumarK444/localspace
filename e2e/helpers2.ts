import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import type { TestServer } from './server';

/** Checks the database and the attachment folder for corruption or inconsistencies. */
export function assertIntegrity(server: TestServer) {
  expect(server.sql('pragma integrity_check;')).toBe('ok');
  expect(server.sql('pragma foreign_key_check;')).toBe(''); // no dangling references
  // the search index must agree with the Page table
  expect(() => server.sql("insert into page_fts(page_fts) values('integrity-check');")).not.toThrow();
  const indexed = Number(server.sql('select count(*) from page_fts_docsize;'));
  const pages = Number(server.sql('select count(*) from Page;'));
  expect(indexed).toBe(pages);
  // every attachment row has a file on disk and every file has a row
  const rows = server.sql('select storagePath from Attachment;').split('\n').filter(Boolean);
  const dir = path.join(server.dir, 'attachments');
  for (const r of rows) expect(fs.existsSync(path.join(dir, r)), `missing file for ${r}`).toBe(true);
  const onDisk = (fs.existsSync(dir) ? (fs.readdirSync(dir, { recursive: true }) as string[]) : []).filter((f) => /\.\w+$/.test(f)).map((f) => f.split(path.sep).join('/'));
  for (const f of onDisk) expect(rows.map((r) => r.split(path.sep).join('/')), `orphan file ${f}`).toContain(f);
  // trees are well-formed: a page is in a folder OR under a page, never both
  expect(server.sql('select count(*) from Page where folderId is not null and parentPageId is not null;')).toBe('0');
}
