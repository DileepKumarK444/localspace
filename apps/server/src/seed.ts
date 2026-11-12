import { prisma } from './db';
import { createFolder } from './modules/folders/service';
import { bold, code, codeBlock, doc, h, hr, inl, link, ol, p, quote, table, ul } from './modules/pages/builders';
import { createPage, setFavorite } from './modules/pages/service';

/** Populates a brand-new (empty) database with realistic sample documentation. */
export async function seedIfEmpty(): Promise<boolean> {
  if ((await prisma.page.count()) + (await prisma.folder.count()) > 0) return false;

  const gs = await createFolder({ name: 'Getting Started' });
  const projects = await createFolder({ name: 'Projects' });
  const alpha = await createFolder({ name: 'Project Alpha', parentId: projects.id });
  const beta = await createFolder({ name: 'Project Beta', parentId: projects.id });
  const notes = await createFolder({ name: 'Personal Notes' });

  const intro = await createPage({
    title: 'Introduction', folderId: gs.id,
    contentJson: doc(
      p('Welcome to ', bold('LocalSpace'), ' — a private, local-first documentation workspace. Everything you write is stored on this computer and never leaves it.'),
      h(2, 'What you can do'),
      ul(['Organise documentation in ', bold('folders'), ' and ', bold('nested pages')], ['Write with a rich-text editor: headings, lists, tables, code blocks and links'], ['Find anything with global search (', code('⌘K'), ')'], ['Rely on ', bold('automatic saving'), ' — there is no save button']),
      h(2, 'First steps'),
      ol(['Pick a page from the sidebar'], ['Click into the page and start typing'], ['Use ', bold('Create'), ' to add new pages and folders'], ['Right-click any item for rename and delete']),
      quote('Tip: star a page to pin it under Favorites at the top of the sidebar.'),
    ),
  });
  const install = await createPage({
    title: 'Installation Guide', folderId: gs.id,
    contentJson: doc(
      p('LocalSpace runs as a small Node.js application on your machine.'),
      h(2, 'Requirements'),
      ul(['Node.js 20 or newer'], ['npm 10 or newer'], ['About 200 MB of disk space']),
      h(2, 'Run it'),
      codeBlock('git clone <your-copy> localspace\ncd localspace\nnpm install\nnpm start', 'bash'),
      p('Then open ', link('http://localhost:4000', 'http://localhost:4000'), ' in your browser.'),
      h(2, 'Where is my data?'),
      p('A single SQLite database and an attachments folder in your user data directory. Backups are written next to them automatically.'),
    ),
  });
  await createPage({
    title: 'Troubleshooting', parentPageId: install.id,
    contentJson: doc(
      p('Common problems and their fixes.'),
      table([
        ['Symptom', 'Likely cause', 'Fix'],
        ['Page will not load', 'Server not running', 'Run npm start and refresh'],
        ['Port already in use', 'Another app uses 4000', 'Start with PORT=4100 npm start'],
        ['Changes not saving', 'Disk full or read-only data directory', 'Free space; check folder permissions'],
      ]),
    ),
  });

  await createPage({
    title: 'Requirements', folderId: alpha.id,
    contentJson: doc(
      h(1, 'Project Alpha — Requirements'),
      p('Alpha delivers the first usable version of the platform for individual users.'),
      h(2, 'Functional requirements'),
      table([
        ['ID', 'Requirement', 'Priority'],
        ['FR-1', 'Create nested folders and pages', 'Must'],
        ['FR-2', 'Rich-text editing with tables and code blocks', 'Must'],
        ['FR-3', 'Automatic saving with visible status', 'Must'],
        ['FR-4', 'Full-text search across all pages', 'Should'],
        ['FR-5', 'Backup and restore', 'Should'],
      ]),
      h(2, 'Non-functional requirements'),
      ul(['Works offline — no cloud services'], ['Never lose user content silently'], ['Opens a 100-page workspace in under a second']),
    ),
  });
  const arch = await createPage({
    title: 'Architecture', folderId: alpha.id,
    contentJson: doc(
      p('LocalSpace is a ', bold('modular monolith'), ': a React single-page app talking to an Express API that stores everything in SQLite.'),
      h(2, 'Components'),
      table([
        ['Layer', 'Technology', 'Responsibility'],
        ['Web', 'React, TipTap, Zustand', 'UI and rich-text editing'],
        ['API', 'Express, TypeScript', 'Validation, transactions, search'],
        ['Storage', 'SQLite + filesystem', 'Pages in the database, attachments on disk'],
      ]),
      h(2, 'Autosave flow'),
      ol(['Editor change → debounce 800 ms'], ['PUT /api/pages/:id with the last known version'], ['Server checks the version, saves, returns the new version'], ['On error the content stays in memory and the save is retried']),
      codeBlock("await api.savePage(id, { version, title, contentJson });\n// 409 means the page changed elsewhere — never overwrite silently", 'ts'),
      quote('Keep it simple, practical and extensible.'),
    ),
  });
  await createPage({
    title: 'Data Model', parentPageId: arch.id,
    contentJson: doc(
      p('Pages and folders form a single tree. A page lives in a folder ', bold('or'), ' under a parent page.'),
      codeBlock('Folder(id, parentId, name)\nPage(id, folderId?, parentPageId?, title, contentJson, contentText, version)\nAttachment(id, pageId, filename, storagePath)\nPageVersion(id, pageId, contentJson)\nFavorite(pageId)', 'text'),
      p('Search uses an SQLite FTS5 index over ', code('title'), ' and ', code('contentText'), '.'),
    ),
  });
  await createPage({
    title: 'API Design', parentPageId: arch.id,
    contentJson: doc(
      p('A small REST API under ', code('/api'), '.'),
      table([
        ['Method', 'Path', 'Purpose'],
        ['GET', '/tree', 'Folders, pages, favorites, recents'],
        ['POST', '/pages', 'Create a page'],
        ['PUT', '/pages/:id', 'Autosave content (versioned)'],
        ['GET', '/search?q=', 'Full-text search'],
      ]),
    ),
  });

  await createPage({
    title: 'Overview', folderId: beta.id,
    contentJson: doc(
      h(2, 'Project Beta'),
      p('Beta adds attachments, version history, and export (Markdown, HTML, PDF).'),
      ul(['Owner: you'], ['Status: planning'], ['Depends on: Project Alpha']),
    ),
  });

  await createPage({
    title: 'Ideas', folderId: notes.id,
    contentJson: doc(
      h(2, 'Ideas'),
      ul(['Command palette for quick actions'], ['Daily notes template'], ['Export a folder as a static website'], ['Dark theme']),
      hr,
      p('Add more ideas below…'),
    ),
  });

  await setFavorite(arch.id, true);
  await setFavorite(intro.id, true);
  return true;
}
