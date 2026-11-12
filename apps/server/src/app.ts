import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import {
  createFolderSchema, createPageSchema, createTemplateSchema, createVersionSchema, importMarkdownSchema, moveSchema, restoreBackupSchema, savePageSchema, trashActionSchema, updateFolderSchema, updatePageMetaSchema, updateTemplateSchema,
  type StatusResponse,
} from '@localspace/shared';
import { dataDir } from './config';
import { getWorkspaceId, prisma } from './db';
import { errorHandler } from './errors';
import { deleteAttachment, getAttachmentFile, listAttachments, MAX_ATTACHMENT_BYTES, saveAttachment } from './modules/attachments/service';
import { createBackup, isRestoring, lastBackupAt, listBackups, restoreBackup } from './modules/backup/service';
import { exportPage, exportWorkspace } from './modules/export/service';
import { importMarkdown } from './modules/import/service';
import { listActivity } from './modules/activity/service';
import * as tpl from './modules/templates/service';
import * as versions from './modules/versions/service';
import * as trash from './modules/trash/service';
import { move } from './modules/tree/move';
import * as folders from './modules/folders/service';
import * as pages from './modules/pages/service';
import { search } from './modules/search/service';
import { getTree } from './modules/tree/service';

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next: NextFunction) => {
  fn(req, res).catch(next);
};

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Refuse API calls while a restore swaps the database file underneath the server.
  app.use('/api', (_req, res, next) => {
    if (isRestoring()) { res.status(503).json({ error: { code: 'RESTORING', message: 'A backup is being restored. Try again in a moment.' } }); return; }
    next();
  });

  // File uploads are sent as the raw request body (Content-Type = the file's type); registered before the JSON parser.
  app.post('/api/pages/:id/attachments', express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES + 1024 }), wrap(async (req, res) => {
    const filename = String(req.query.filename ?? 'file');
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.status(201).json(await saveAttachment(req.params.id, filename, String(req.headers['content-type'] ?? '').split(';')[0], body));
  }));

  app.use(express.json({ limit: '12mb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => void res.json({ ok: true }));

  api.get('/status', wrap(async (_req, res) => {
    const workspaceId = await getWorkspaceId();
    const ws = await prisma.workspace.findFirstOrThrow();
    const [pageCount, folderCount] = await Promise.all([
      prisma.page.count({ where: { workspaceId, deletedAt: null } }),
      prisma.folder.count({ where: { workspaceId, deletedAt: null } }),
    ]);
    const body: StatusResponse = { workspaceName: ws.name, pageCount, folderCount, dataDir, lastBackupAt: lastBackupAt() };
    res.json(body);
  }));

  api.get('/tree', wrap(async (_req, res) => void res.json(await getTree())));

  api.post('/folders', wrap(async (req, res) => void res.status(201).json(await folders.createFolder(createFolderSchema.parse(req.body)))));
  api.patch('/folders/:id', wrap(async (req, res) => void res.json(await folders.updateFolder(req.params.id, updateFolderSchema.parse(req.body)))));
  api.delete('/folders/:id', wrap(async (req, res) => void res.json(await folders.deleteFolder(req.params.id))));

  api.post('/pages', wrap(async (req, res) => void res.status(201).json(await pages.createPage(createPageSchema.parse(req.body)))));
  api.get('/pages/:id', wrap(async (req, res) => void res.json(await pages.getPage(req.params.id))));
  api.put('/pages/:id', wrap(async (req, res) => void res.json(await pages.savePage(req.params.id, savePageSchema.parse(req.body)))));
  api.patch('/pages/:id', wrap(async (req, res) => void res.json(await pages.updatePageMeta(req.params.id, updatePageMetaSchema.parse(req.body)))));
  api.delete('/pages/:id', wrap(async (req, res) => void res.json(await pages.deletePage(req.params.id))));
  api.put('/pages/:id/favorite', wrap(async (req, res) => { await pages.setFavorite(req.params.id, true); res.status(204).end(); }));
  api.delete('/pages/:id/favorite', wrap(async (req, res) => { await pages.setFavorite(req.params.id, false); res.status(204).end(); }));
  api.post('/pages/:id/view', wrap(async (req, res) => { await pages.markViewed(req.params.id); res.status(204).end(); }));

  api.post('/pages/:id/duplicate', wrap(async (req, res) => void res.status(201).json(await pages.duplicatePage(req.params.id))));
  api.post('/move', wrap(async (req, res) => { await move(moveSchema.parse(req.body)); res.status(204).end(); }));
  api.get('/templates', wrap(async (_req, res) => void res.json(await tpl.listAllTemplates())));
  api.post('/templates', wrap(async (req, res) => void res.status(201).json(await tpl.createTemplate(createTemplateSchema.parse(req.body)))));
  api.patch('/templates/:id', wrap(async (req, res) => void res.json(await tpl.updateTemplate(req.params.id, updateTemplateSchema.parse(req.body)))));
  api.delete('/templates/:id', wrap(async (req, res) => { await tpl.deleteTemplate(req.params.id); res.status(204).end(); }));

  api.get('/pages/:id/attachments', wrap(async (req, res) => void res.json(await listAttachments(req.params.id))));
  api.delete('/attachments/:id', wrap(async (req, res) => { await deleteAttachment(req.params.id); res.status(204).end(); }));
  api.get('/attachments/:id/file', wrap(async (req, res) => {
    const f = await getAttachmentFile(req.params.id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `${f.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(f.abs);
  }));

  api.get('/trash', wrap(async (_req, res) => void res.json(await trash.listTrash())));
  api.post('/trash/restore', wrap(async (req, res) => { const b = trashActionSchema.parse(req.body); await trash.restore(b.kind, b.id); res.status(204).end(); }));
  api.post('/trash/purge', wrap(async (req, res) => { const b = trashActionSchema.parse(req.body); await trash.purge(b.kind, b.id); res.status(204).end(); }));
  api.delete('/trash', wrap(async (_req, res) => { await trash.emptyTrash(); res.status(204).end(); }));

  api.get('/pages/:id/versions', wrap(async (req, res) => void res.json(await versions.listVersions(req.params.id))));
  api.post('/pages/:id/versions', wrap(async (req, res) => void res.status(201).json(await versions.createVersion(req.params.id, createVersionSchema.parse(req.body ?? {}).label))));
  api.get('/pages/:id/versions/:vid', wrap(async (req, res) => void res.json(await versions.getVersion(req.params.id, req.params.vid))));
  api.post('/pages/:id/versions/:vid/restore', wrap(async (req, res) => void res.json(await versions.restoreVersion(req.params.id, req.params.vid))));
  api.delete('/pages/:id/versions/:vid', wrap(async (req, res) => { await versions.deleteVersion(req.params.id, req.params.vid); res.status(204).end(); }));

  api.get('/pages/:id/export', wrap(async (req, res) => {
    const r = await exportPage(req.params.id, String(req.query.format ?? 'md'));
    res.setHeader('Content-Type', r.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (r.inline) res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data: http: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
    res.setHeader('Content-Disposition', `${r.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(r.filename)}`);
    res.send(r.body);
  }));
  api.get('/export/workspace', wrap(async (_req, res) => {
    const r = await exportWorkspace();
    res.setHeader('Content-Type', r.contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}`);
    res.send(r.body);
  }));
  api.post('/import/markdown', wrap(async (req, res) => {
    const b = importMarkdownSchema.parse(req.body);
    res.status(201).json(await importMarkdown(b.files, b.parent ?? null));
  }));

  api.get('/activity', wrap(async (req, res) => void res.json(await listActivity({ limit: Number(req.query.limit) || undefined, before: req.query.before ? String(req.query.before) : undefined, type: req.query.type ? String(req.query.type) : undefined }))));

  api.get('/search', wrap(async (req, res) => {
    const type = ['all', 'pages', 'folders', 'attachments'].includes(String(req.query.type)) ? (String(req.query.type) as 'all' | 'pages' | 'folders' | 'attachments') : 'all';
    const sort = req.query.sort === 'recent' ? 'recent' : 'relevance';
    res.json(await search(String(req.query.q ?? ''), { type, sort, scope: req.query.scope ? String(req.query.scope) : null, limit: Number(req.query.limit) || undefined }));
  }));

  api.get('/backups', (_req, res) => void res.json(listBackups()));
  api.post('/backups', wrap(async (_req, res) => void res.status(201).json(await createBackup())));
  api.post('/backups/restore', wrap(async (req, res) => void res.json(await restoreBackup(restoreBackupSchema.parse(req.body).name))));

  api.use((_req, res) => void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } }));
  app.use('/api', api);

  // Serve the built web app when present (production-style run: `npm start`).
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => void res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
