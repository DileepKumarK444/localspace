import { docToHtml, type DocNode, type PageDetail, type VersionDetail, type VersionInfo } from '@localspace/shared';
import { MAX_AUTO_VERSIONS, VERSION_INTERVAL_MS } from '../../config';
import { prisma } from '../../db';
import { notFound } from '../../errors';
import { logActivity } from '../activity/service';
import { extractText, parseDoc } from '../pages/content';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const EMPTY = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });

const info = (v: { id: string; title: string; label: string | null; createdAt: Date; contentJson: string }): VersionInfo => ({
  id: v.id, title: v.title, label: v.label, createdAt: v.createdAt.toISOString(), size: v.contentJson.length,
});

/** Keeps the newest MAX_AUTO_VERSIONS automatic snapshots; labelled (manual) versions are never pruned. */
async function prune(tx: Tx, pageId: string) {
  const old = await tx.pageVersion.findMany({ where: { pageId, label: null }, orderBy: { createdAt: 'desc' }, skip: MAX_AUTO_VERSIONS, select: { id: true } });
  if (old.length) await tx.pageVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

/**
 * Called inside the save transaction with the page's state BEFORE the update. Takes a snapshot of that state
 * when the content is about to change and the newest snapshot is older than the interval, so history keeps
 * roughly one entry per editing burst instead of one per keystroke.
 */
export async function maybeSnapshotBeforeSave(tx: Tx, current: { id: string; title: string; contentJson: string }, newContentJson: string | undefined) {
  if (newContentJson === undefined || newContentJson === current.contentJson || current.contentJson === EMPTY) return;
  const latest = await tx.pageVersion.findFirst({ where: { pageId: current.id }, orderBy: { createdAt: 'desc' } });
  if (latest && latest.contentJson === current.contentJson) return;
  if (latest && Date.now() - latest.createdAt.getTime() < VERSION_INTERVAL_MS) return;
  await tx.pageVersion.create({ data: { pageId: current.id, title: current.title, contentJson: current.contentJson } });
  await prune(tx, current.id);
}

export async function listVersions(pageId: string): Promise<VersionInfo[]> {
  if (!(await prisma.page.findFirst({ where: { id: pageId, deletedAt: null }, select: { id: true } }))) throw notFound('Page');
  return (await prisma.pageVersion.findMany({ where: { pageId }, orderBy: { createdAt: 'desc' } })).map(info);
}

export async function getVersion(pageId: string, versionId: string): Promise<VersionDetail> {
  const v = await prisma.pageVersion.findFirst({ where: { id: versionId, pageId, page: { deletedAt: null } } });
  if (!v) throw notFound('Version');
  return { ...info(v), contentJson: v.contentJson, html: docToHtml(JSON.parse(v.contentJson) as DocNode) };
}

/** Saves the page's current content as a named version (always, even if unchanged since the last one). */
export async function createVersion(pageId: string, label?: string): Promise<VersionInfo> {
  const page = await prisma.page.findFirst({ where: { id: pageId, deletedAt: null } });
  if (!page) throw notFound('Page');
  return info(await prisma.pageVersion.create({ data: { pageId, title: page.title, contentJson: page.contentJson, label: label || 'Manual version' } }));
}

/**
 * Restores an older version. The current state is snapshotted first ("Before restore"), so a restore is itself
 * undoable from the history list. The page version counter is bumped so any open editor sees a conflict, not a silent overwrite.
 */
export async function restoreVersion(pageId: string, versionId: string): Promise<PageDetail> {
  const v = await prisma.pageVersion.findFirst({ where: { id: versionId, pageId, page: { deletedAt: null } } });
  if (!v) throw notFound('Version');
  const text = extractText(parseDoc(v.contentJson));
  const page = await prisma.$transaction(async (tx) => {
    const cur = await tx.page.findUniqueOrThrow({ where: { id: pageId } });
    if (cur.contentJson !== v.contentJson || cur.title !== v.title) {
      await tx.pageVersion.create({ data: { pageId, title: cur.title, contentJson: cur.contentJson, label: 'Before restore' } });
    }
    return tx.page.update({ where: { id: pageId }, data: { title: v.title, contentJson: v.contentJson, contentText: text, version: { increment: 1 } } });
  });
  await logActivity('version_restored', 'page', pageId, page.title);
  return {
    id: page.id, title: page.title, folderId: page.folderId, parentPageId: page.parentPageId, position: page.position,
    updatedAt: page.updatedAt.toISOString(), createdAt: page.createdAt.toISOString(), contentJson: page.contentJson, version: page.version,
  };
}

export async function deleteVersion(pageId: string, versionId: string) {
  const r = await prisma.pageVersion.deleteMany({ where: { id: versionId, pageId } });
  if (!r.count) throw notFound('Version');
}
