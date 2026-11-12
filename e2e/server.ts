import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
let nextPort = 4100;

/** A LocalSpace server on its own port and temp data directory; can be stopped and restarted on the same data. */
export class TestServer {
  readonly port = nextPort++;
  readonly dir = fs.mkdtempSync(path.join(os.tmpdir(), `localspace-e2e-${this.port}-`));
  private proc: ChildProcess | null = null;
  log = '';

  get url() { return `http://127.0.0.1:${this.port}`; }

  async start() {
    this.proc = spawn(path.join(root, 'node_modules/.bin/tsx'), ['apps/server/src/index.ts'], {
      cwd: root,
      env: { ...process.env, PORT: String(this.port), LOCALSPACE_DATA_DIR: this.dir },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group, so the whole tree (tsx → node) can be killed
    });
    this.proc.stdout?.on('data', (d) => (this.log += d));
    this.proc.stderr?.on('data', (d) => (this.log += d));
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      try { if ((await fetch(`${this.url}/api/health`)).ok) return; } catch { /* not up yet */ }
      if (this.proc.exitCode !== null) throw new Error(`server exited early:\n${this.log}`);
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`server did not start:\n${this.log}`);
  }

  private async terminate(signal: NodeJS.Signals) {
    const p = this.proc;
    if (!p || p.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => p.once('exit', () => resolve()));
    try { process.kill(-p.pid!, signal); } catch { /* already gone */ }
    await exited;
    // wait until the port is really free (the child can outlive its launcher by a moment)
    for (let i = 0; i < 50; i++) {
      try { await fetch(`${this.url}/api/health`, { signal: AbortSignal.timeout(300) }); await new Promise((r) => setTimeout(r, 100)); } catch { break; }
    }
    this.proc = null;
  }

  async stop() { await this.terminate('SIGTERM'); }

  /** Simulates a crash / power loss: no graceful shutdown, no chance to flush anything. */
  async kill9() { await this.terminate('SIGKILL'); }

  async restart() { await this.stop(); await this.start(); }

  async cleanup() { await this.stop(); fs.rmSync(this.dir, { recursive: true, force: true }); }

  async api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.url}/api${url}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 204) return undefined as T;
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(data)}`);
    return data as T;
  }

  /** Reads the raw SQLite file with the sqlite3 CLI (independent of the app's own code). */
  sql(query: string): string {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    return execFileSync('sqlite3', [path.join(this.dir, 'localspace.db'), query]).toString().trim();
  }
}

export const doc = (...paragraphs: string[]) => JSON.stringify({ type: 'doc', content: paragraphs.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });
/** A valid solid-colour PNG of the given size (so real mouse clicks can hit it). */
export function makePng(w: number, h: number, rgb: [number, number, number] = [56, 139, 255]): Buffer {
  const zlib = require('node:zlib') as typeof import('node:zlib');
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const PNG = makePng(120, 60);
