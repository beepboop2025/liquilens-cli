import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type Region = "in" | "us";

function cacheDir(): string {
  if (process.env.XDG_CACHE_HOME)
    return path.join(process.env.XDG_CACHE_HOME, "liquilens");
  if (process.platform === "win32" && process.env.LOCALAPPDATA)
    return path.join(process.env.LOCALAPPDATA, "liquilens", "cache");
  return path.join(os.homedir(), ".cache", "liquilens");
}

function cacheFile(region: Region): string {
  return path.join(cacheDir(), `last-${region}.json`);
}

export interface CachedEntry<T> {
  data: T;
  savedAt: string; // ISO timestamp
}

export function saveCached<T>(region: Region, data: T): void {
  try {
    const file = cacheFile(region);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const entry: CachedEntry<T> = { data, savedAt: new Date().toISOString() };
    // Write-then-rename so a crash mid-write never corrupts the cache.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry));
    fs.renameSync(tmp, file);
  } catch {
    // Cache is best-effort; never let it break the live path.
  }
}

export function loadCached<T>(region: Region): CachedEntry<T> | null {
  try {
    const raw = fs.readFileSync(cacheFile(region), "utf8");
    const entry = JSON.parse(raw) as CachedEntry<T>;
    if (!entry?.data || !entry.savedAt) return null;
    return entry;
  } catch {
    return null;
  }
}

export function ageMinutes(savedAt: string, now = Date.now()): number {
  const t = Date.parse(savedAt);
  if (Number.isNaN(t)) return Infinity;
  return Math.max(0, Math.round((now - t) / 60_000));
}

export function describeAge(minutes: number): string {
  if (!Number.isFinite(minutes)) return "unknown age";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
