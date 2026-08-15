import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface EvidenceBlobRecord {
  blobId: string;
  bytes: number;
  createdAt: string;
  updatedAt: string;
  references: string[];
}
interface EvidenceManifest { version: 1; blobs: Record<string, EvidenceBlobRecord> }
export interface CouncilEvidenceStats { blobs: number; references: number; bytes: number; maxBytes: number; overBudget: boolean }

const SHA256 = /^[0-9a-f]{64}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

function privateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try { chmodSync(path, 0o700); } catch {}
}
function validBlobId(blobId: string): string {
  const id = blobId.trim().toLowerCase();
  if (!SHA256.test(id)) throw new Error("Council evidence blob id is invalid");
  return id;
}
function validReference(reference: string): string {
  const value = reference.trim();
  if (!REF.test(value)) throw new Error("Council evidence reference is invalid");
  return value;
}

export class CouncilEvidenceStore {
  private readonly root: string;
  private readonly manifestPath: string;
  private readonly blobsDir: string;
  private readonly maxBytes: number;
  private manifest: EvidenceManifest;

  constructor(root: string, options: { maxBytes?: number } = {}) {
    this.root = root;
    this.manifestPath = join(root, "manifest.json");
    this.blobsDir = join(root, "blobs");
    this.maxBytes = Math.max(1024 * 1024, Math.min(8 * 1024 * 1024 * 1024, Math.trunc(options.maxBytes ?? DEFAULT_MAX_BYTES)));
    privateDir(this.root);
    privateDir(this.blobsDir);
    this.manifest = this.load();
    this.reconcile();
  }

  putPng(bytes: Buffer, reference: string): EvidenceBlobRecord {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("Council evidence PNG bytes are required");
    const ref = validReference(reference);
    const blobId = createHash("sha256").update(bytes).digest("hex");
    const path = this.blobPath(blobId);
    const now = new Date().toISOString();
    let record = this.manifest.blobs[blobId];
    if (!record) {
      if (!existsSync(path)) writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
      try { chmodSync(path, 0o600); } catch {}
      record = this.manifest.blobs[blobId] = { blobId, bytes: bytes.length, createdAt: now, updatedAt: now, references: [] };
    } else if (!existsSync(path)) {
      writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
      try { chmodSync(path, 0o600); } catch {}
      record.bytes = bytes.length;
    }
    if (!record.references.includes(ref)) record.references.push(ref);
    record.references = record.references.slice(-10_000);
    record.updatedAt = now;
    this.pruneUnreferenced();
    this.write();
    return structuredClone(record);
  }

  addReference(blobId: string, reference: string): EvidenceBlobRecord {
    const id = validBlobId(blobId);
    const ref = validReference(reference);
    const record = this.manifest.blobs[id];
    if (!record || !existsSync(this.blobPath(id))) throw new Error(`Council evidence blob does not exist: ${id}`);
    if (!record.references.includes(ref)) record.references.push(ref);
    record.updatedAt = new Date().toISOString();
    this.write();
    return structuredClone(record);
  }

  findByReference(reference: string): EvidenceBlobRecord | undefined {
    const ref = validReference(reference);
    const record = Object.values(this.manifest.blobs).find(candidate => candidate.references.includes(ref));
    return record ? structuredClone(record) : undefined;
  }

  removeReference(blobId: string, reference: string): boolean {
    const id = validBlobId(blobId);
    const ref = validReference(reference);
    const record = this.manifest.blobs[id];
    if (!record) return false;
    record.references = record.references.filter(value => value !== ref);
    record.updatedAt = new Date().toISOString();
    if (record.references.length > 0) {
      this.write();
      return false;
    }
    rmSync(this.blobPath(id), { force: true });
    delete this.manifest.blobs[id];
    this.write();
    return true;
  }

  readPng(blobId: string): Buffer | undefined {
    const id = validBlobId(blobId);
    const record = this.manifest.blobs[id];
    const path = this.blobPath(id);
    if (!record || !existsSync(path)) return undefined;
    const bytes = readFileSync(path);
    if (createHash("sha256").update(bytes).digest("hex") !== id) throw new Error(`Council evidence blob failed integrity check: ${id}`);
    return bytes;
  }

  stats(): CouncilEvidenceStats {
    const records = Object.values(this.manifest.blobs);
    const bytes = records.reduce((sum, record) => sum + record.bytes, 0);
    return {
      blobs: records.length,
      references: records.reduce((sum, record) => sum + record.references.length, 0),
      bytes,
      maxBytes: this.maxBytes,
      overBudget: bytes > this.maxBytes,
    };
  }

  list(): EvidenceBlobRecord[] {
    return Object.values(this.manifest.blobs).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(value => structuredClone(value));
  }

  clearReferences(predicate: (reference: string) => boolean): number {
    let removed = 0;
    for (const record of Object.values(this.manifest.blobs)) {
      const before = record.references.length;
      record.references = record.references.filter(reference => !predicate(reference));
      removed += before - record.references.length;
    }
    this.pruneUnreferenced();
    if (removed) this.write();
    return removed;
  }

  private load(): EvidenceManifest {
    if (!existsSync(this.manifestPath)) return { version: 1, blobs: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.manifestPath, "utf8")) as EvidenceManifest;
      if (parsed.version !== 1 || !parsed.blobs || typeof parsed.blobs !== "object" || Array.isArray(parsed.blobs)) throw new Error("invalid evidence manifest");
      for (const [id, record] of Object.entries(parsed.blobs)) {
        if (!SHA256.test(id) || record.blobId !== id || !Array.isArray(record.references)) throw new Error("invalid evidence blob record");
        record.references = record.references.filter(reference => REF.test(reference)).slice(-10_000);
      }
      return parsed;
    } catch (error) {
      try { renameSync(this.manifestPath, `${this.manifestPath}.corrupt-${Date.now()}`); } catch {}
      throw new Error(`Council evidence manifest is corrupt and was quarantined: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private reconcile(): void {
    let changed = false;
    for (const [id, record] of Object.entries(this.manifest.blobs)) {
      const path = this.blobPath(id);
      if (!existsSync(path)) {
        delete this.manifest.blobs[id];
        changed = true;
        continue;
      }
      const size = statSync(path).size;
      if (record.bytes !== size) { record.bytes = size; changed = true; }
    }
    if (changed) this.write();
  }

  private pruneUnreferenced(): void {
    for (const [id, record] of Object.entries(this.manifest.blobs)) {
      if (record.references.length) continue;
      rmSync(this.blobPath(id), { force: true });
      delete this.manifest.blobs[id];
    }
  }

  private blobPath(blobId: string): string { return join(this.blobsDir, `${validBlobId(blobId)}.png`); }

  private write(): void {
    privateDir(dirname(this.manifestPath));
    const temp = `${this.manifestPath}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(temp, `${JSON.stringify(this.manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      renameSync(temp, this.manifestPath);
      try { chmodSync(this.manifestPath, 0o600); } catch {}
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }
}
