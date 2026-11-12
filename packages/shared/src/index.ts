import { z } from 'zod';

/* ---------- API response types ---------- */
export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
}
export interface PageNode {
  id: string;
  title: string;
  folderId: string | null;
  parentPageId: string | null;
  position: number;
  updatedAt: string;
}
export interface TreeResponse {
  folders: FolderNode[];
  pages: PageNode[];
  favorites: string[];
  recents: string[];
}
export interface PageDetail extends PageNode {
  contentJson: string;
  version: number;
  createdAt: string;
}
export interface SaveResponse {
  id: string;
  title: string;
  version: number;
  updatedAt: string;
}
export interface SearchPageHit {
  id: string;
  title: string;
  path: string[];
  /** Snippet with matches wrapped in \u0001 … \u0002 (client escapes + highlights). */
  snippet: string;
  updatedAt: string;
  /** True when the title itself matched (ranked above body-only matches). */
  titleMatch: boolean;
}
export interface SearchFolderHit {
  id: string;
  name: string;
  path: string[];
}
export interface SearchAttachmentHit {
  id: string;
  pageId: string;
  pageTitle: string;
  filename: string;
  mime: string;
  path: string[];
  url: string;
}
export interface SearchResponse {
  pages: SearchPageHit[];
  folders: SearchFolderHit[];
  attachments: SearchAttachmentHit[];
}
export type SearchType = 'all' | 'pages' | 'folders' | 'attachments';
export type SearchSort = 'relevance' | 'recent';

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}
export interface StatusResponse {
  workspaceName: string;
  pageCount: number;
  folderCount: number;
  dataDir: string;
  lastBackupAt: string | null;
}
export interface ApiError {
  error: { code: string; message: string };
}

/* ---------- Request schemas ---------- */
const name = z.string().trim().min(1, 'Name is required').max(200);
const id = z.string().min(1);

export const createFolderSchema = z.object({ name, parentId: id.nullable().optional() });
export const updateFolderSchema = z.object({ name: name.optional(), parentId: id.nullable().optional() });
export const createPageSchema = z.object({
  title: name,
  templateId: z.string().optional(),
  folderId: id.nullable().optional(),
  parentPageId: id.nullable().optional(),
});
export const updatePageMetaSchema = z.object({
  title: name.optional(),
  folderId: id.nullable().optional(),
  parentPageId: id.nullable().optional(),
});
export const savePageSchema = z.object({
  version: z.number().int().positive(),
  title: name.optional(),
  contentJson: z.string().max(10_000_000).optional(),
});

export const moveSchema = z.object({
  kind: z.enum(['folder', 'page']),
  id,
  /** New container; null = workspace root. Folders can only go in folders or root. */
  parent: z.object({ kind: z.enum(['folder', 'page']), id }).nullable(),
  /** Place before this sibling (same kind); omit/null to append. */
  beforeId: id.nullable().optional(),
});
export const trashActionSchema = z.object({ kind: z.enum(['folder', 'page']), id });
export const restoreBackupSchema = z.object({ name: z.string().min(1).max(200) });

/* ---------- Phase 3 response types ---------- */
export interface TemplateInfo { id: string; name: string; description: string; icon: string; custom: boolean }
export const createTemplateSchema = z.object({ name, description: z.string().trim().max(200).optional(), fromPageId: id });
export const updateTemplateSchema = z.object({ name: name.optional(), description: z.string().trim().max(200).optional() });
/** Placeholders substituted when a page is created from a template. */
export const TEMPLATE_VARIABLES = ['{{date}}', '{{time}}', '{{weekday}}', '{{title}}'] as const;
export interface AttachmentInfo { id: string; pageId: string; filename: string; mime: string; size: number; createdAt: string; url: string }
export interface TrashItem { kind: 'folder' | 'page'; id: string; title: string; deletedAt: string; childCount: number }

export const importMarkdownSchema = z.object({
  files: z.array(z.object({ name: z.string().max(255), markdown: z.string().max(5_000_000) })).min(1).max(200),
  parent: z.object({ kind: z.enum(['folder', 'page']), id }).nullable().optional(),
});
export interface ImportResult { created: { id: string; title: string }[] }
export interface VersionInfo { id: string; title: string; label: string | null; createdAt: string; size: number }
export interface VersionDetail extends VersionInfo { contentJson: string; html: string }
export const createVersionSchema = z.object({ label: z.string().trim().max(100).optional() });
export type ActivityType = 'created' | 'edited' | 'renamed' | 'moved' | 'deleted' | 'restored' | 'duplicated' | 'imported' | 'version_restored';
export interface ActivityItem { id: string; type: ActivityType; kind: 'folder' | 'page'; entityId: string; title: string; createdAt: string; exists: boolean }
export * from './convert';
