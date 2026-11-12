import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api/client';

export type SaveState = 'saved' | 'saving' | 'error' | 'conflict';
export interface SavePatch { title?: string; contentJson?: string }
interface Draft extends SavePatch { baseVersion: number }

const draftKey = (id: string) => `localspace.draft.${id}`;
export function readDraft(id: string, serverVersion: number): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(id)) ?? 'null') as Draft | null;
    return d && d.baseVersion === serverVersion ? d : null;
  } catch { return null; }
}
const writeDraft = (id: string, d: Draft) => { try { localStorage.setItem(draftKey(id), JSON.stringify(d)); } catch { /* storage full/blocked: in-memory pending still holds the data */ } };
export const clearDraft = (id: string) => { try { localStorage.removeItem(draftKey(id)); } catch { /* ignore */ } };

const DEBOUNCE_MS = 800;

/** The open page's flush function, so dialogs (history, export) can make sure nothing is pending before they act. */
export const flushCurrent: { fn: null | (() => Promise<void>) } = { fn: null };

/**
 * Debounced autosave with safety nets:
 *  - unsaved changes are mirrored to localStorage until the server confirms them
 *  - failed saves are retried with backoff and never dropped
 *  - a stale version (409) stops retries and surfaces a conflict instead of overwriting
 *  - pending changes are flushed when the page is left, and the browser warns on close
 */
export function useAutosave(pageId: string, initialVersion: number, onSaved: (r: { title: string; version: number }) => void, hasInitialUnsaved: boolean) {
  const [state, setState] = useState<SaveState>(hasInitialUnsaved ? 'saving' : 'saved');
  const [message, setMessage] = useState('');
  const version = useRef(initialVersion);
  const pending = useRef<SavePatch | null>(null);
  const inflight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const retry = useRef<ReturnType<typeof setTimeout>>();
  const attempts = useRef(0);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    clearTimeout(retry.current);
    if (inflight.current) return;
    while (pending.current) {
      const batch = pending.current;
      pending.current = null;
      inflight.current = true;
      setState('saving');
      try {
        const res = await api.savePage(pageId, { version: version.current, ...batch });
        version.current = res.version;
        attempts.current = 0;
        onSavedRef.current({ title: res.title, version: res.version });
        if (!pending.current) clearDraft(pageId);
      } catch (e) {
        pending.current = { ...batch, ...(pending.current ?? {}) }; // never drop unsaved content
        inflight.current = false;
        const err = e instanceof ApiError ? e : new ApiError(0, 'ERROR', (e as Error).message);
        setMessage(err.message);
        if (err.status === 409) { setState('conflict'); return; }
        setState('error');
        attempts.current += 1;
        retry.current = setTimeout(() => void flush(), Math.min(2000 * 2 ** (attempts.current - 1), 15000));
        return;
      }
      inflight.current = false;
    }
    setState('saved');
  }, [pageId]);

  /** Record a change; it is saved after a short pause. */
  const schedule = useCallback((patch: SavePatch) => {
    pending.current = { ...(pending.current ?? {}), ...patch };
    let existing: Draft | null = null;
    try { existing = JSON.parse(localStorage.getItem(draftKey(pageId)) ?? 'null'); } catch { /* ignore */ }
    writeDraft(pageId, { ...(existing && existing.baseVersion === version.current ? existing : { baseVersion: version.current }), ...patch });
    setState((s) => (s === 'conflict' ? s : 'saving'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
  }, [flush, pageId]);

  /** After a conflict: adopt the server's latest version number and save our content on top of it. */
  const overwrite = useCallback(async () => {
    try {
      const latest = await api.getPage(pageId);
      version.current = latest.version;
      void flush();
    } catch (e) { setMessage((e as Error).message); setState('error'); }
  }, [pageId, flush]);

  useEffect(() => {
    if (hasInitialUnsaved) {
      const d = readDraft(pageId, initialVersion);
      if (d) { pending.current = { title: d.title, contentJson: d.contentJson }; void flush(); }
    }
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current || inflight.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      void flush(); // leaving the page: persist anything still pending
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    flushCurrent.fn = flush;
    return () => { if (flushCurrent.fn === flush) flushCurrent.fn = null; };
  }, [flush]);

  return { state, message, schedule, flush, overwrite };
}
