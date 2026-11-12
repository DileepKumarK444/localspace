import { Link, useParams } from 'react-router-dom';
import { FilePlus2, FileText, Folder, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { hrefFor, useActions } from '../lib/actions';
import { buildTree } from '../lib/tree';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';
import Breadcrumbs from './Breadcrumbs';

export default function FolderView() {
  const { id = '' } = useParams();
  const { folders, pages, loaded } = useTree();
  const { newPage, newFolder, requestDelete } = useActions();
  const folder = folders.find((f) => f.id === id);
  if (!folder) {
    return <div className="center-msg">{loaded ? <div><h2 style={{ fontSize: 18, color: 'var(--text)', marginBottom: 6 }}>This folder no longer exists</h2><Link className="link-btn" to="/">Go to workspace home</Link></div> : 'Loading…'}</div>;
  }
  const item = (function find(list: ReturnType<typeof buildTree>): ReturnType<typeof buildTree>[number] | null {
    for (const i of list) { if (i.id === id) return i; const f = find(i.children); if (f) return f; }
    return null;
  })(buildTree(folders, pages));
  const target = { kind: 'folder' as const, id };
  return (
    <>
      <div className="page-head">
        <Breadcrumbs kind="folder" id={id} />
        <div className="head-row" style={{ paddingBottom: 12 }}>
          <span className="status" style={{ color: 'var(--text-3)' }}>Folder</span>
          <button className="btn ghost" onClick={() => newPage(target)}><FilePlus2 className="ic" />New page</button>
          <button className="btn ghost" onClick={() => newFolder(target)}><FolderPlus className="ic" />New subfolder</button>
          <button className="icon-btn" aria-label="Rename folder" title="Rename" onClick={() => useUi.getState().setRenaming(id)}><Pencil className="ic" /></button>
          <button className="icon-btn" aria-label="Delete folder" title="Delete" onClick={() => requestDelete('folder', id)}><Trash2 className="ic" /></button>
        </div>
      </div>
      <div className="doc">
        <h1 className="title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Folder style={{ width: 30, height: 30, color: '#8590a2' }} />{folder.name}</h1>
        <div className="meta"><span>{item?.children.length ?? 0} item{item?.children.length === 1 ? '' : 's'}</span></div>
        {item && item.children.length > 0 ? (
          <div className="folder-cards">
            {item.children.map((c) => (
              <Link key={c.id} className="card" to={hrefFor(c.kind, c.id)}>
                {c.kind === 'folder' ? <Folder className="ic" /> : <FileText className="ic" />}{c.title}
              </Link>
            ))}
          </div>
        ) : <p style={{ color: 'var(--text-3)' }}>This folder is empty. Create a page or subfolder to get started.</p>}
      </div>
    </>
  );
}
