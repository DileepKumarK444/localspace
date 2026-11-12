import type {
  ActivityItem, AttachmentInfo, BackupInfo, ImportResult, FolderNode, PageDetail, SaveResponse, SearchResponse, SearchSort, SearchType, StatusResponse, TemplateInfo, VersionDetail, VersionInfo, TrashItem, TreeResponse,
} from '@localspace/shared';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    const isFile = body instanceof Blob;
    res = await fetch(`/api${url}`, {
      method, signal,
      headers: isFile ? { 'content-type': body.type || 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: isFile ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the LocalSpace server');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: { error?: { code?: string; message?: string } } | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body (e.g. proxy error) */ }
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? res.statusText);
  return data as unknown as T;
}

export const api = {
  tree: () => request<TreeResponse>('GET', '/tree'),
  status: () => request<StatusResponse>('GET', '/status'),
  createFolder: (name: string, parentId: string | null) => request<FolderNode>('POST', '/folders', { name, parentId }),
  renameFolder: (id: string, name: string) => request<FolderNode>('PATCH', `/folders/${id}`, { name }),
  deleteFolder: (id: string) => request<{ folders: number; pages: number }>('DELETE', `/folders/${id}`),
  createPage: (title: string, loc: { folderId?: string | null; parentPageId?: string | null }, templateId?: string) => request<PageDetail>('POST', '/pages', { title, ...loc, ...(templateId ? { templateId } : {}) }),
  duplicatePage: (id: string) => request<PageDetail>('POST', `/pages/${id}/duplicate`),
  move: (m: { kind: 'folder' | 'page'; id: string; parent: { kind: 'folder' | 'page'; id: string } | null; beforeId?: string | null }) => request<void>('POST', '/move', m),
  templates: () => request<TemplateInfo[]>('GET', '/templates'),
  attachments: (pageId: string) => request<AttachmentInfo[]>('GET', `/pages/${pageId}/attachments`),
  uploadAttachment: (pageId: string, file: File) => request<AttachmentInfo>('POST', `/pages/${pageId}/attachments?filename=${encodeURIComponent(file.name || 'pasted-file')}`, file),
  deleteAttachment: (id: string) => request<void>('DELETE', `/attachments/${id}`),
  trash: () => request<TrashItem[]>('GET', '/trash'),
  restoreTrash: (kind: 'folder' | 'page', id: string) => request<void>('POST', '/trash/restore', { kind, id }),
  purgeTrash: (kind: 'folder' | 'page', id: string) => request<void>('POST', '/trash/purge', { kind, id }),
  emptyTrash: () => request<void>('DELETE', '/trash'),
  backups: () => request<BackupInfo[]>('GET', '/backups'),
  createBackup: () => request<BackupInfo>('POST', '/backups'),
  restoreBackup: (name: string) => request<{ safetyBackup: string }>('POST', '/backups/restore', { name }),
  getPage: (id: string) => request<PageDetail>('GET', `/pages/${id}`),
  savePage: (id: string, body: { version: number; title?: string; contentJson?: string }) => request<SaveResponse>('PUT', `/pages/${id}`, body),
  renamePage: (id: string, title: string) => request<PageDetail>('PATCH', `/pages/${id}`, { title }),
  deletePage: (id: string) => request<{ pages: number }>('DELETE', `/pages/${id}`),
  setFavorite: (id: string, on: boolean) => request<void>(on ? 'PUT' : 'DELETE', `/pages/${id}/favorite`),
  markViewed: (id: string) => request<void>('POST', `/pages/${id}/view`),
  search: (q: string, o: { type?: SearchType; scope?: string | null; sort?: SearchSort; limit?: number } = {}, signal?: AbortSignal) => {
    const qs = new URLSearchParams({ q });
    if (o.type && o.type !== 'all') qs.set('type', o.type);
    if (o.scope) qs.set('scope', o.scope);
    if (o.sort && o.sort !== 'relevance') qs.set('sort', o.sort);
    if (o.limit) qs.set('limit', String(o.limit));
    return request<SearchResponse>('GET', `/search?${qs}`, undefined, signal);
  },
  activity: (o: { limit?: number; before?: string; type?: string } = {}) => {
    const qs = new URLSearchParams();
    if (o.limit) qs.set('limit', String(o.limit));
    if (o.before) qs.set('before', o.before);
    if (o.type) qs.set('type', o.type);
    return request<ActivityItem[]>('GET', `/activity?${qs}`);
  },
  versions: (pageId: string) => request<VersionInfo[]>('GET', `/pages/${pageId}/versions`),
  version: (pageId: string, vid: string) => request<VersionDetail>('GET', `/pages/${pageId}/versions/${vid}`),
  createVersion: (pageId: string, label?: string) => request<VersionInfo>('POST', `/pages/${pageId}/versions`, { label }),
  restoreVersion: (pageId: string, vid: string) => request<PageDetail>('POST', `/pages/${pageId}/versions/${vid}/restore`),
  deleteVersion: (pageId: string, vid: string) => request<void>('DELETE', `/pages/${pageId}/versions/${vid}`),
  createTemplate: (name: string, fromPageId: string, description?: string) => request<TemplateInfo>('POST', '/templates', { name, fromPageId, description }),
  deleteTemplate: (id: string) => request<void>('DELETE', `/templates/${id}`),
  importMarkdown: (files: { name: string; markdown: string }[], parent: { kind: 'folder' | 'page'; id: string } | null) => request<ImportResult>('POST', '/import/markdown', { files, parent }),
};

/** Download/print URLs are plain links so the browser handles saving. */
export const exportUrl = (pageId: string, format: 'md' | 'html' | 'pdf') => `/api/pages/${pageId}/export?format=${format}`;
export const workspaceExportUrl = '/api/export/workspace';
