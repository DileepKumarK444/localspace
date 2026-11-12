# LocalSpace – Phase 1: UI/UX Design

Clickable prototype: `design/prototype.html` (open in any browser, no build step).

## 1. Screen layouts

```
┌──────────────────────────────────────────────────────────────────────┐
│ ▣ LocalSpace   Workspace Recent Favorites Templates  [🔍 Search ⌘K]  [+ Create] ⚙ DK │  Top bar 48px
├───────────────┬──────────────────────────────────────────────────────┤
│ ▣ My Workspace│ 🏠 › Projects › Project Alpha › Architecture         │
│ [Filter] [+]  │ ● Saved                        ☆  ⤓  ⟲  ⋯            │  Sticky page header
│ FAVORITES     │ ↶↷ | Text H2 H3 | B I U | • 1. ☑ | 🔗 ▦ 🖼 </> | ❝ ⓘ ─  │  Toolbar
│  ▸ Architecture                                                      │
│ RECENTLY VIEWED│   Architecture                                      │
│ PAGES    [📁+]│   Updated just now · by You                          │
│  ▾ Getting St.│   body: paragraphs, callouts, tables, code, tasks    │
│  ▾ Projects   │                                                      │
│    ▾ Alpha    │                                                      │
│ ● Backed up 2h│   (max readable width 860px, centered)               │
│        ⚙ Settings                                                    │
└───────────────┴──────────────────────────────────────────────────────┘
```

- **Screen 1 Workspace / Screen 2 Editor:** one view. The sidebar (288px, collapsible on narrow screens) holds navigation. The main pane has breadcrumbs, save status, page actions, a sticky formatting toolbar and the document.
- **Screen 3 Search:** a command-palette overlay opened with `⌘K` or the top-bar field. It has a live query, filter chips (All / Pages / Folders / Attachments), ranked results with highlighted snippets and the folder path, and arrow-key navigation with Enter to open.
- **Screen 4 Folder/page management:** tree with chevrons, a hover `⋯` button, right-click context menu (new child page or subfolder, rename, duplicate, move, favorite, delete), inline rename, drag-and-drop with a drop highlight, and a delete confirmation dialog showing how many descendants are affected.
- **Folder view:** selecting a folder shows its children as cards.

## 2. Navigation structure
- **Top bar:** Workspace, Recent, Favorites and Templates (the last two are Phase 3). It also has global search, Create and settings.
- **Sidebar:** Favorites, Recently viewed, then the Pages tree. The footer shows backup status and Settings.
- **Routes (React Router):** `/` redirects to the last viewed page, `/page/:id`, `/folder/:id`, `/search?q=`, `/settings`, `/trash`.

## 3. Component hierarchy
```
<App>
 ├ <TopBar> <Brand/> <TopNav/> <SearchTrigger/> <CreateButton/> <UserMenu/>
 ├ <Sidebar>
 │   <WorkspaceHeader/> <TreeFilter/> <FavoritesList/> <RecentList/>
 │   <PageTree> <TreeNode/> (recursive; <InlineRename/>, <NodeMenu/>) </PageTree>
 │   <SidebarFooter> <BackupStatus/> <SettingsLink/>
 ├ <PageView>
 │   <Breadcrumbs/> <SaveStatus/> <PageActions/>
 │   <EditorToolbar/> <PageTitle/> <TipTapEditor> (extensions: table, code-block, callout, task-list, slash-menu)
 ├ <FolderView/>
 └ overlays: <SearchPalette/> <ContextMenu/> <ConfirmDialog/> <Toaster/>
Stores (Zustand): treeStore, pageStore (+autosave), uiStore (palette, sidebar), searchStore
```

## 4. Design system
| Token | Value | Use |
|---|---|---|
| `--bg` | #FFFFFF | Page, top bar |
| `--surface` | #F7F8F9 | Sidebar, table headers |
| `--surface-2` | #F1F2F4 | Hover |
| `--border` | #DCDFE4 / #EBECF0 | Dividers, inputs |
| `--text` / `-2` / `-3` | #172B4D / #44546F / #6B778C | Primary, secondary, muted |
| `--accent` | #0C66E4 (hover #0055CC, soft #E9F2FF) | Primary actions, selection, links |
| success / warn / danger | #1F845A / #B38600 / #C9372C | Saved, warnings, destructive |
| Callouts | blue, green, yellow, red tints | Info, note, warning, error |
| Code | #0F172A background | Code blocks |

- **Type:** Inter, with a system fallback. Title 34/700, H2 24, H3 18, body 15/1.7, UI 14. JetBrains Mono for code.
- **Shape and spacing:** radius 6px (controls) and 8px (cards, callouts); 4px spacing grid; 28px tree rows; 30px toolbar buttons.
- **Elevation:** one shadow for menus and dialogs; borders everywhere else.
- **Icons:** Lucide.
- **Motion:** 120ms chevron rotation, pulsing save dot, overlay fade.
- **Dark theme:** all colours are CSS variables, so dark mode in Phase 4 only swaps tokens.
- **Responsive:** under 900px the sidebar hides (hamburger drawer in the real build) and the document uses full width.
- **Accessibility:** visible focus rings, keyboard-navigable palette and menus, and contrast of at least AA for text.

## 5. Key interaction flows
1. **Create a page:** Create (top bar or sidebar), or right-click then New child page. The page is added under the selected item, opens at once, and its title enters inline rename.
2. **Edit and autosave:** typing sets the status to *Saving…* (amber dot). After about 800ms of inactivity it saves and shows *Saved* (green). On failure it shows *Save failed – retrying* in red, content stays in memory and local storage, and the browser warns before closing.
3. **Find:** `⌘K`, type, arrow keys, Enter. The tree expands to the result and the page opens.
4. **Reorganise:** drag a node onto a folder or page to nest it, or use Move to… from the menu.
5. **Delete:** confirmation states the number of descendants. Items go to Trash, recoverable for 30 days, and a toast offers Undo.
6. **Insert content:** toolbar buttons or `/` slash menu (heading, list, table, code block, callout, divider).

## 6. UX recommendations and alternatives
- **Unified tree:** pages and folders share one tree, so a page can have child pages and a folder can hold pages. Confluence splits these into separate concepts, and I think one tree is simpler. The alternative is folders for organisation only, with page nesting limited to child pages.
- **Slash menu** (Notion-style) in addition to the toolbar, which keeps the toolbar uncluttered.
- **Floating selection toolbar** for inline formatting. The fixed toolbar stays in the prototype for discoverability, and the real editor could offer either.
- **Page width toggle** (readable vs full-width) for wide tables, a small Phase 3 add.
- **Backup status in the sidebar footer** keeps the data-safety promise visible.
- **Trash instead of permanent delete**, as agreed in Phase 0.

## 7. Prototype limitations
It is a design mock built with plain HTML and `contentEditable`, not TipTap. Data is in memory and resets on reload, and Move to… only shows a toast (drag-and-drop works). Real persistence, tables with row/column controls, and syntax highlighting arrive with the POC.
