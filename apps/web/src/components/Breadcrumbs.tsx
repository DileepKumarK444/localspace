import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { hrefFor } from '../lib/actions';
import { pathTo, type NodeKind } from '../lib/tree';
import { useTree } from '../store/tree';

export default function Breadcrumbs({ kind, id }: { kind: NodeKind; id: string }) {
  const folders = useTree((s) => s.folders);
  const pages = useTree((s) => s.pages);
  const trail = pathTo(kind, id, folders, pages);
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link to="/" aria-label="Home"><Home className="ic" /></Link>
      {trail.map((t, i) => (
        <Fragment key={t.id}>
          <ChevronRight className="ic" />
          {i === trail.length - 1 ? <span className="cur" aria-current="page">{t.title}</span> : <Link to={hrefFor(t.kind, t.id)}>{t.title}</Link>}
        </Fragment>
      ))}
    </nav>
  );
}
