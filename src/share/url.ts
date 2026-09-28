/**
 * Circuit <-> URL fragment. JSON -> deflate-raw -> base64url (SPEC §5).
 * Uses the browser's built-in CompressionStream (also in Node 18+), so no dependency.
 */
import type { Circuit } from '../schematic/model';

export const URL_WARN_BYTES = 8 * 1024;

/** The circuit as it is written to disk / URL: in-memory wire ids are dropped. */
export function toFileJson(c: Circuit): string {
  const clean: Circuit = {
    v: 1,
    grid: c.grid,
    parts: c.parts,
    wires: c.wires.map(({ from, to }) => ({ from, to })),
    probes: c.probes,
    analysis: c.analysis,
    labels: c.labels ?? [],
  };
  return JSON.stringify(clean);
}

/** Accept older/looser files: fill in anything missing. Throws on garbage. */
export function migrate(raw: unknown): Circuit {
  if (!raw || typeof raw !== 'object') throw new Error('This is not a circuit file.');
  const o = raw as Partial<Circuit> & { v?: number };
  const v = o.v ?? 1;
  if (v > 1) throw new Error(`This circuit was saved by a newer version (v${v}).`);
  if (!Array.isArray(o.parts) || !Array.isArray(o.wires)) throw new Error('This is not a circuit file (no parts or wires).');
  return {
    v: 1,
    grid: typeof o.grid === 'number' ? o.grid : 10,
    parts: o.parts.map((p) => ({ ...p, rot: (p.rot ?? 0) as Circuit['parts'][number]['rot'] })),
    wires: o.wires,
    probes: Array.isArray(o.probes) ? o.probes : [],
    analysis: o.analysis ?? { kind: 'dc' },
    labels: Array.isArray(o.labels) ? o.labels : [],
  };
}

async function streamBytes(input: Uint8Array, kind: 'compress' | 'decompress'): Promise<Uint8Array> {
  const stream = kind === 'compress' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(input as unknown as BufferSource);
  void writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeCircuit(c: Circuit): Promise<string> {
  const bytes = new TextEncoder().encode(toFileJson(c));
  return toBase64Url(await streamBytes(bytes, 'compress'));
}

export async function decodeCircuit(s: string): Promise<Circuit> {
  const bytes = await streamBytes(fromBase64Url(s), 'decompress');
  return migrate(JSON.parse(new TextDecoder().decode(bytes)));
}

export function circuitFromHash(hash: string): string | null {
  const m = /^#c=([A-Za-z0-9_-]+)$/.exec(hash);
  return m ? m[1] : null;
}
