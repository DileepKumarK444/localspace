# Phase 5 – Test report

Run with `npm run test:all` (server tests → typecheck → end-to-end). Last full run: **51 server tests + 50 end-to-end tests passed, 0 type errors**, twice in a row.

## How it is tested
- **Server tests** (`apps/server/test`, Vitest, 51): HTTP API against a temp database — CRUD, move/reorder rules, soft delete & Trash, attachments, backups/restore, export/import, converters (incl. XSS), version history, templates, activity, search syntax.
- **End-to-end** (`e2e/`, Playwright driving real Chrome, 50): real mouse and keyboard input against a real server started on a throwaway data directory (never your real data). The harness can stop, restart or `SIGKILL` the server mid-test.
- **Integrity checks** after the risky scenarios: `PRAGMA integrity_check`, `foreign_key_check`, FTS5 `integrity-check`, search index row count = page count, every attachment row has a file and every file has a row, no page in both a folder and under a page.

## What the end-to-end suite covers
| Area | Verified |
|---|---|
| Creating & editing | folders, nested folders, pages, child pages via UI; bold/heading/list/table persist; table add column / delete row / cell colour; **merge cells by mouse drag**; favorites; rename sync; confirm-before-delete |
| Nested navigation | expand/collapse, breadcrumbs, selection highlight, 12-level nesting, missing/deleted page messages |
| Drag & drop (real mouse) | into folder, nest under page, reorder before/after, invalid drops refused, Move dialog |
| Autosave | Saving → Saved, reload persistence, error state, retry with backoff, automatic recovery |
| Persistence | graceful restart, **SIGKILL crash**, sample data intact, search/attachments still served |
| Attachments | picker upload, paste, drop, image width, 25 MB limit, non-images forced to download, delete removes file, purge removes files |
| Search accuracy | fresh edits found, phrases, `-exclude`, substring titles, folders, files, scope, results page, deleted pages vanish, restored return, unicode/RTL/emoji |
| Backup & restore | via Settings, undo via safety backup, attachments included, corrupt backup refused, index rebuilt |
| Error recovery | server down while typing, draft recovery after closing the tab, `beforeunload` warning, two-tab conflict (load latest / overwrite) |
| Versions, export, import | save/restore/undo-restore; Markdown/HTML/PDF-print/ZIP downloads; Markdown import round-trip |
| Security | script/HTML in titles, folder names, content, links, search, history, exports: shown as text, nothing executes |
| UX | theme persists with no light flash; contrast ≥ 4.5:1 in both themes; real keyboard shortcuts and tree arrow keys; phone-width layout on every screen; **axe WCAG A/AA audit** of pages, dialogs, menus, drawer in both themes |
| Concurrency | 40 simultaneous saves/moves/renames/favorites keep the database consistent |

## Defects found and fixed in Phase 5
1. **Concurrent writes returned 500 errors** (SQLite writer contention across Prisma's connection pool). Now a single serialised connection with generous timeouts.
2. **Confirmation dialogs could render behind other dialogs** (e.g. deleting a template). Confirm/prompt dialogs now sit above everything.
3. **Clicking an image didn't keep it selected** (Chrome click handling dropped to a text cursor), so the image-size tools vanished.
4. **Table tools row appeared on demand and shifted the page**, breaking mouse drag-selection of cells (merge hit the wrong cells). Reserved a fixed row.
5. **Search palette could lose text typed right after opening** (reset ran after open). Now resets on close.
6. **Symbol/emoji-only searches returned nothing** even when a title contained them.
7. **Accessibility:** tree items lacked `role="group"`; low-contrast shortcut keys, muted text and code comments (light and dark).
8. **No usable layout on phones** (sidebar simply disappeared). Now a drawer; wide tables scroll sideways.
9. Earlier in this phase's test development: templates with empty text nodes could blank a page (fixed in Phase 3), backup churn (fixed in Phase 3).

## Known limits (not defects)
- Single-user, local only; the server binds to `127.0.0.1` with no login.
- PDF export uses the browser's print dialog ("Save as PDF"); the print view and a real PDF render were verified, the dialog itself was not automated.
- Only Chrome was exercised end to end (Safari/Firefox not run). The test machine's own print dialog is not covered.
- Activity history starts at the Phase 4 migration; versions store full copies (no diff view).
- Pages that are open in two tabs conflict on a first-saver-wins basis (the second tab must choose "Load latest" or "Overwrite").
