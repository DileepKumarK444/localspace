# LocalSpace

Private, local-first documentation platform (POC). React + TipTap on the front, Express + Prisma + SQLite on the back. Nothing leaves your machine.

## Run

```bash
npm install          # once
npm start            # builds the web app and serves everything at http://localhost:4000
```

Development mode with hot reload (web on http://localhost:5180, API on :4000):

```bash
npm run dev
```

Stop: press `Ctrl+C` in the terminal, or `lsof -ti :4000 | xargs kill`.

## Features (Phases 1–4)

Folders and nested pages · TipTap editor (tables, task lists, callouts, expandable sections, code highlighting, images) · autosave with conflict protection · drag-and-drop and Move · Trash · attachments · backup/restore ·
**Export** (page → Markdown/HTML/PDF-via-print; workspace → ZIP) · **Markdown import** · **version history** with restore · **custom templates** with `{{date}}` variables ·
**recent activity** · search with `"phrases"`, `-exclusions`, filters, folder scope · **colours** (36+ text/highlight/cell colours, custom picker, per-folder and per-page icon colours) · **light/dark theme** · **keyboard shortcuts** (`⌘/` or `?` shows them).

## Test

```bash
npm test             # server API + converter tests (vitest)
npm run typecheck    # server + web
npm run test:e2e     # end-to-end in real Chrome (Playwright) on a throwaway data directory
npm run test:all     # all of the above
```

See [docs/PHASE5-TEST-REPORT.md](docs/PHASE5-TEST-REPORT.md) for what is covered.

## Data

Stored outside the repo in `~/Library/Application Support/LocalSpace-POC/`:

| Path | What |
|---|---|
| `localspace.db` | SQLite database (pages, folders, favorites, FTS5 index) |
| `backups/` | `backup-<time>/` folders: database snapshot + hard-linked attachments. Taken at start (at most hourly) and every 6 h; last 10 kept |
| `attachments/` | Uploaded images and files (`ab/<id>.<ext>`) |

Override with `LOCALSPACE_DATA_DIR=/some/path npm start`. A fresh data directory is seeded with sample content.

## Layout

```
apps/server     Express API, Prisma schema + migrations, search, backup
apps/web        React app (Vite, Tailwind, TipTap, Zustand, React Router)
packages/shared Types and zod schemas shared by both
design/         Phase 1 prototype and design doc
docs/           Screenshots
```
