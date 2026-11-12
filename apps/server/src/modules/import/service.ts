import { markdownToDoc, type ImportResult } from '@localspace/shared';
import { createPage } from '../pages/service';

/** Imports Markdown files as pages under `parent` (folder, page or root). Each file becomes one page. */
export async function importMarkdown(files: { name: string; markdown: string }[], parent: { kind: 'folder' | 'page'; id: string } | null): Promise<ImportResult> {
  const created: ImportResult['created'] = [];
  for (const f of files) {
    const { title, doc } = markdownToDoc(f.markdown);
    const fallback = f.name.replace(/\.(md|markdown|txt)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported page';
    const page = await createPage({
      title: (title ?? fallback).slice(0, 200),
      folderId: parent?.kind === 'folder' ? parent.id : null,
      parentPageId: parent?.kind === 'page' ? parent.id : null,
      contentJson: JSON.stringify(doc),
      via: 'imported',
    });
    created.push({ id: page.id, title: page.title });
  }
  return { created };
}
