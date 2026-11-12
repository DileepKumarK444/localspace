import type { PageDetail, SaveResponse } from '@localspace/shared';
import { getWorkspaceId, prisma } from '../../db';
import { HttpError, badRequest, conflict, notFound } from '../../errors';
import { loadMeta, pageSubtree } from '../tree/hierarchy';
import { extractText, parseDoc } from './content';
import { applyVariables, resolveTemplate } from '../templates/service';
import { maybeSnapshotBeforeSave } from '../versions/service';
import { logActivity } from '../activity/service';

const EMPTY_DOC = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });

type PageRow = Awaited<ReturnType<typeof prisma.page.findFirstOrThrow>>;
const toDetail = (p: PageRow): PageDetail => ({
  id: p.id, title: p.title, folderId: p.folderId, parentPageId: p.parentPageId, position: p.position,
  updatedAt: p.updatedAt.toISOString(), createdAt: p.createdAt.toISOString(), contentJson: p.contentJson, version: p.version,
});

async function nextPosition(workspaceId: string, folderId: string | null, parentPageId: string | null) {
  const agg = await prisma.page.aggregate({ where: { workspaceId, folderId, parentPageId, deletedAt: null }, _max: { position: true } });
  return (agg._max.position ?? -1) + 1;
}

async function assertLocation(folderId: string | null, parentPageId: string | null) {
  if (folderId && parentPageId) throw badRequest('A page can be in a folder or under a parent page, not both');
  if (folderId && !(await prisma.folder.findFirst({ where: { id: folderId, deletedAt: null } }))) throw notFound('Folder');
  if (parentPageId && !(await prisma.page.findFirst({ where: { id: parentPageId, deletedAt: null } }))) throw notFound('Parent page');
}

export async function createPage(input: { title: string; folderId?: string | null; parentPageId?: string | null; contentJson?: string; templateId?: string; via?: 'created' | 'imported' }) {
  const workspaceId = await getWorkspaceId();
  const folderId = input.folderId ?? null;
  const parentPageId = input.parentPageId ?? null;
  await assertLocation(folderId, parentPageId);
  const position = await nextPosition(workspaceId, folderId, parentPageId);
  let contentJson = input.contentJson;
  if (!contentJson && input.templateId) {
    const raw = await resolveTemplate(input.templateId);
    if (!raw) throw badRequest('Unknown template');
    contentJson = applyVariables(raw, { title: input.title });
  }
  contentJson = contentJson ?? EMPTY_DOC;
  const contentText = extractText(parseDoc(contentJson));
  const created = toDetail(await prisma.page.create({ data: { workspaceId, folderId, parentPageId, title: input.title, contentJson, contentText, position } }));
  await logActivity(input.via ?? 'created', 'page', created.id, created.title);
  return created;
}

export async function getPage(id: string): Promise<PageDetail> {
  const page = await prisma.page.findFirst({ where: { id, deletedAt: null } });
  if (!page) throw notFound('Page');
  return toDetail(page);
}

/**
 * Autosave endpoint. Uses optimistic concurrency: the client sends the version it last saw and
 * a stale version is rejected with 409 so a second tab can never silently overwrite newer content.
 */
export async function savePage(id: string, input: { version: number; title?: string; contentJson?: string }): Promise<SaveResponse> {
  let contentText: string | undefined;
  if (input.contentJson !== undefined) {
    try {
      contentText = extractText(parseDoc(input.contentJson));
    } catch (e) {
      throw badRequest((e as Error).message);
    }
  }
  let contentChanged = false, titleChanged = false;
  const saved = await prisma.$transaction(async (tx) => {
    const current = await tx.page.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw notFound('Page');
    contentChanged = input.contentJson !== undefined && input.contentJson !== current.contentJson;
    titleChanged = input.title !== undefined && input.title !== current.title;
    if (current.version !== input.version) {
      throw new HttpError(409, 'VERSION_CONFLICT', 'This page was changed elsewhere. Reload to see the latest version.');
    }
    await maybeSnapshotBeforeSave(tx, current, input.contentJson);
    const updated = await tx.page.update({
      where: { id },
      data: {
        version: { increment: 1 },
        ...(input.title !== undefined && { title: input.title }),
        ...(input.contentJson !== undefined && { contentJson: input.contentJson, contentText }),
      },
    });
    return { id: updated.id, title: updated.title, version: updated.version, updatedAt: updated.updatedAt.toISOString() };
  });
  if (titleChanged) await logActivity('renamed', 'page', id, saved.title);
  if (contentChanged) await logActivity('edited', 'page', id, saved.title);
  return saved;
}

/** Rename and/or move (metadata only; does not touch content). */
export async function updatePageMeta(id: string, input: { title?: string; folderId?: string | null; parentPageId?: string | null }) {
  const workspaceId = await getWorkspaceId();
  const existing = await prisma.page.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw notFound('Page');
  const data: { title?: string; folderId?: string | null; parentPageId?: string | null; position?: number } = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.folderId !== undefined || input.parentPageId !== undefined) {
    const folderId = input.folderId ?? null;
    const parentPageId = input.parentPageId ?? null;
    await assertLocation(folderId, parentPageId);
    if (parentPageId) {
      const { folders, pages } = await loadMeta(workspaceId);
      void folders;
      if (pageSubtree([id], new Set(), pages).has(parentPageId)) throw badRequest('Cannot move a page under itself or its own child');
    }
    data.folderId = folderId;
    data.parentPageId = parentPageId;
    data.position = await nextPosition(workspaceId, folderId, parentPageId);
  }
  const updated = await prisma.page.update({ where: { id }, data });
  if (input.title !== undefined && input.title !== existing.title) await logActivity('renamed', 'page', id, updated.title);
  if (data.position !== undefined) await logActivity('moved', 'page', id, updated.title);
  return toDetail(updated);
}

/** Soft-deletes a page and all of its descendant pages. */
export async function deletePage(id: string): Promise<{ pages: number }> {
  const workspaceId = await getWorkspaceId();
  const { pages } = await loadMeta(workspaceId);
  if (!pages.some((p) => p.id === id)) throw notFound('Page');
  const ids = pageSubtree([id], new Set(), pages);
  await prisma.page.updateMany({ where: { id: { in: [...ids] } }, data: { deletedAt: new Date() } });
  await logActivity('deleted', 'page', id, pages.find((p) => p.id === id)!.title);
  return { pages: ids.size };
}

export async function setFavorite(pageId: string, on: boolean) {
  const workspaceId = await getWorkspaceId();
  await getPage(pageId);
  if (on) await prisma.favorite.upsert({ where: { pageId }, create: { pageId, workspaceId }, update: {} });
  else await prisma.favorite.deleteMany({ where: { pageId } });
}

export async function markViewed(pageId: string) {
  await getPage(pageId);
  await prisma.recentView.upsert({ where: { pageId }, create: { pageId }, update: { viewedAt: new Date() } });
}

/** Copies a page (content and attachments) next to the original. Child pages are not copied. */
export async function duplicatePage(id: string): Promise<PageDetail> {
  const workspaceId = await getWorkspaceId();
  const src = await prisma.page.findFirst({ where: { id, deletedAt: null }, include: { attachments: true } });
  if (!src) throw notFound('Page');
  const position = await nextPosition(workspaceId, src.folderId, src.parentPageId);
  const copy = await prisma.$transaction(async (tx) => {
    let contentJson = src.contentJson;
    const created = await tx.page.create({
      data: { workspaceId, folderId: src.folderId, parentPageId: src.parentPageId, title: `${src.title} (copy)`.slice(0, 200), contentJson, contentText: src.contentText, position },
    });
    // Attachments get new rows that share the same stored file; content links are re-pointed to the copies.
    for (const a of src.attachments) {
      const nid = `${a.id.slice(0, 12)}${Math.random().toString(16).slice(2, 14)}`;
      await tx.attachment.create({ data: { id: nid, pageId: created.id, filename: a.filename, mime: a.mime, size: a.size, storagePath: a.storagePath, sha256: a.sha256 } });
      contentJson = contentJson.split(`/api/attachments/${a.id}/`).join(`/api/attachments/${nid}/`);
    }
    return contentJson === src.contentJson ? created : tx.page.update({ where: { id: created.id }, data: { contentJson } });
  });
  await logActivity('duplicated', 'page', copy.id, copy.title);
  return toDetail(copy);
}
