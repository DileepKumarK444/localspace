import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AttachmentInfo } from '@localspace/shared';
import { attachmentsDir } from '../../config';
import { prisma } from '../../db';
import { badRequest, notFound } from '../../errors';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Types that are safe to display inline in the browser. Everything else is served as a download. */
const INLINE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf']);

const toInfo = (a: { id: string; pageId: string; filename: string; mime: string; size: number; createdAt: Date }): AttachmentInfo => ({
  id: a.id, pageId: a.pageId, filename: a.filename, mime: a.mime, size: a.size, createdAt: a.createdAt.toISOString(), url: `/api/attachments/${a.id}/file`,
});

const safeName = (n: string) => path.basename(n).replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || 'file';

export async function saveAttachment(pageId: string, filename: string, mime: string, data: Buffer): Promise<AttachmentInfo> {
  if (!data.length) throw badRequest('Empty file');
  if (data.length > MAX_ATTACHMENT_BYTES) throw badRequest('File is larger than 25 MB');
  if (!(await prisma.page.findFirst({ where: { id: pageId, deletedAt: null } }))) throw notFound('Page');
  const name = safeName(filename);
  const id = crypto.randomBytes(12).toString('hex');
  const rel = path.join(id.slice(0, 2), `${id}${path.extname(name).toLowerCase().slice(0, 12)}`);
  const abs = path.join(attachmentsDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
  try {
    const row = await prisma.attachment.create({
      data: { id, pageId, filename: name, mime: mime || 'application/octet-stream', size: data.length, storagePath: rel, sha256: crypto.createHash('sha256').update(data).digest('hex') },
    });
    return toInfo(row);
  } catch (e) {
    fs.rmSync(abs, { force: true });
    throw e;
  }
}

export async function listAttachments(pageId: string): Promise<AttachmentInfo[]> {
  const rows = await prisma.attachment.findMany({ where: { pageId, page: { deletedAt: null } }, orderBy: { createdAt: 'desc' } });
  return rows.map(toInfo);
}

export async function getAttachmentFile(id: string) {
  const a = await prisma.attachment.findFirst({ where: { id, page: { deletedAt: null } } });
  if (!a) throw notFound('Attachment');
  const abs = path.join(attachmentsDir, a.storagePath);
  if (!abs.startsWith(attachmentsDir + path.sep) || !fs.existsSync(abs)) throw notFound('Attachment file');
  return { abs, filename: a.filename, mime: a.mime, inline: INLINE_MIMES.has(a.mime) };
}

/** Deletes files no Attachment row refers to any more (rows may share a file after page duplication). */
export async function removeOrphanFiles(storagePaths: string[]) {
  for (const rel of new Set(storagePaths)) {
    if ((await prisma.attachment.count({ where: { storagePath: rel } })) === 0) {
      const abs = path.join(attachmentsDir, rel);
      if (abs.startsWith(attachmentsDir + path.sep)) fs.rmSync(abs, { force: true });
    }
  }
}

export async function deleteAttachment(id: string) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a) throw notFound('Attachment');
  await prisma.attachment.delete({ where: { id } });
  await removeOrphanFiles([a.storagePath]);
}
