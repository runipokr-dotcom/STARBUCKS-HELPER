export const CATALOG_BACKUP_FORMAT = "starbucks-helper-catalog-backup-v1";

export function normalizeForManifest(value) {
  if (
    value == null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) return value;
  if (Array.isArray(value)) return value.map(normalizeForManifest);
  if (typeof value.toMillis === "function") {
    return { __timestamp__: value.toMillis() };
  }
  if (value.path && typeof value.path === "string") {
    return { __reference__: value.path };
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalizeForManifest(value[key])]),
    );
  }
  return String(value);
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeForManifest(value));
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function encodePath(path) {
  const bytes = new TextEncoder().encode(path);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function isCatalogBackupPath(path) {
  if (typeof path !== "string") return false;
  return path.startsWith("catalogShares/")
    || path.startsWith("adminCatalogs/")
    || path.startsWith("partnerCatalogShares/")
    || path === "privateAdminData/partnerCatalogLink";
}

export function assertDocumentPath(path) {
  if (typeof path !== "string" || !path || path.includes("//")) {
    throw new Error("invalid document path");
  }
  const segments = path.split("/");
  if (segments.length % 2 !== 0 || segments.some((segment) => !segment)) {
    throw new Error(`invalid document path: ${path}`);
  }
  if (!isCatalogBackupPath(path)) {
    throw new Error(`path outside catalog scope: ${path}`);
  }
  return path;
}

export async function buildDocumentRecord(path, data, expectedHash = "") {
  assertDocumentPath(path);
  const normalized = normalizeForManifest(data);
  const hash = await sha256Hex(normalized);
  if (expectedHash && hash !== expectedHash) {
    throw new Error(`manifest hash mismatch: ${path}`);
  }
  return { path, hash, data: normalized };
}

export async function documentAggregateHash(documents) {
  const rows = [...documents]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path, hash }) => [path, hash]);
  return sha256Hex(rows);
}

export function compareDocumentSets(previous, current) {
  const previousMap = new Map(previous.map((item) => [item.path, item.hash]));
  const currentMap = new Map(current.map((item) => [item.path, item.hash]));
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];
  for (const [path, hash] of currentMap) {
    if (!previousMap.has(path)) added.push(path);
    else if (previousMap.get(path) !== hash) changed.push(path);
    else unchanged.push(path);
  }
  for (const path of previousMap.keys()) {
    if (!currentMap.has(path)) removed.push(path);
  }
  for (const list of [added, removed, changed, unchanged]) list.sort();
  return {
    exact: added.length === 0 && removed.length === 0 && changed.length === 0,
    added,
    removed,
    changed,
    unchanged,
  };
}
