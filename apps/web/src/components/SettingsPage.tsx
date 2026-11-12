import { useCallback, useEffect, useState } from 'react';
import { DatabaseBackup, Download, HardDrive, Monitor, Moon, Palette, RotateCcw, Sun } from 'lucide-react';
import type { BackupInfo, StatusResponse } from '@localspace/shared';
import { api, workspaceExportUrl } from '../api/client';
import { useTheme } from '../store/theme';
import { useTree } from '../store/tree';
import { useUi } from '../store/ui';

const fmt = (n: number) => (n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function SettingsPage() {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, askConfirm } = useUi.getState();
  const theme = useTheme();

  const load = useCallback(async () => {
    try { const [b, s] = await Promise.all([api.backups(), api.status()]); setBackups(b); setStatus(s); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try { await api.createBackup(); toast('Backup created'); await load(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const restore = (b: BackupInfo) => askConfirm({
    title: 'Restore this backup?',
    message: `Your workspace will be replaced with the backup from ${new Date(b.createdAt).toLocaleString()}. Everything changed since then is lost from the workspace — but a safety backup of the current state is made first, so you can undo this by restoring it.`,
    confirmLabel: 'Restore backup',
    onConfirm: async () => {
      try {
        const r = await api.restoreBackup(b.name);
        await Promise.all([useTree.getState().load(), load()]);
        toast(`Backup restored. Previous state saved as ${r.safetyBackup}`);
        window.location.assign('/');
      } catch (e) { toast((e as Error).message, 'error'); }
    },
  });

  return (
    <div className="doc">
      <h1 className="title" style={{ fontSize: 28 }}>Settings</h1>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <h2 className="sect"><Palette className="ic" />Appearance</h2>
      <div className="theme-opts" role="radiogroup" aria-label="Theme">
        {([['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'Match system', Monitor]] as const).map(([v, label, Icon]) => (
          <button key={v} role="radio" aria-checked={theme.choice === v} className={`theme-opt ${theme.choice === v ? 'on' : ''}`} onClick={() => theme.set(v)}><Icon className="ic" />{label}</button>
        ))}
      </div>
      <h2 className="sect"><HardDrive className="ic" />Storage</h2>
      <div className="kv">
        <span>Workspace</span><b>{status?.workspaceName ?? '…'}</b>
        <span>Contents</span><b>{status ? `${status.pageCount} pages · ${status.folderCount} folders` : '…'}</b>
        <span>Data folder</span><code>{status?.dataDir ?? '…'}</code>
      </div>
      <h2 className="sect"><Download className="ic" />Export</h2>
      <p style={{ color: 'var(--text-2)', marginBottom: 12, lineHeight: 1.5 }}>Download everything as Markdown files in a ZIP (folders become directories, images are included). To import Markdown, use <b>Create → Import Markdown…</b>. Single pages can be exported as Markdown, HTML or PDF from the page's ⋯ menu.</p>
      <a className="btn ghost" style={{ border: '1px solid var(--border)', textDecoration: 'none' }} href={workspaceExportUrl} download>Export workspace (.zip)</a>
      <h2 className="sect"><DatabaseBackup className="ic" />Backups</h2>
      <p style={{ color: 'var(--text-2)', marginBottom: 12, lineHeight: 1.5 }}>A backup contains the whole database and all attachments. One is created automatically when LocalSpace starts and every 6 hours; the latest 10 are kept.</p>
      <button className="btn primary" disabled={busy} onClick={() => void create()}>{busy ? 'Working…' : 'Back up now'}</button>
      <div className="list" style={{ marginTop: 14 }}>
        {backups === null && !error && <p className="empty">Loading…</p>}
        {backups?.length === 0 && <p className="empty">No backups yet.</p>}
        {backups?.map((b, i) => (
          <div key={b.name} className="list-row">
            <span style={{ flex: 1, minWidth: 0 }}><b>{new Date(b.createdAt).toLocaleString()}</b>{i === 0 && <span className="pill">latest</span>}<small style={{ display: 'block', color: 'var(--text-3)' }}>{b.name} · {fmt(b.size)}</small></span>
            <button className="btn sm ghost" onClick={() => restore(b)}><RotateCcw className="ic" />Restore</button>
          </div>
        ))}
      </div>
    </div>
  );
}
