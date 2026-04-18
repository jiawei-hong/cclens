import type { Session, MemoryEntry } from '../../src/types'

// IndexedDB-backed cache for parsed sessions + memory entries, plus the root
// directory handle. Cache validity is keyed on (path, lastModified, size), so
// a file that hasn't changed on disk skips re-parsing entirely.

const DB_NAME = 'cclens-cache'
const DB_VERSION = 1
const SESSIONS_STORE = 'sessions'
const MEMORY_STORE = 'memory'
const META_STORE = 'meta'

export type CachedSession = {
  path: string
  lastModified: number
  size: number
  session: Session
}

export type CachedMemory = {
  path: string
  lastModified: number
  size: number
  entry: MemoryEntry
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) db.createObjectStore(SESSIONS_STORE, { keyPath: 'path' })
      if (!db.objectStoreNames.contains(MEMORY_STORE))   db.createObjectStore(MEMORY_STORE,   { keyPath: 'path' })
      if (!db.objectStoreNames.contains(META_STORE))     db.createObjectStore(META_STORE,     { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  p.catch(() => { dbPromise = null })
  dbPromise = p
  return p
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ── Sessions cache ────────────────────────────────────────────────────────────

export async function readSessionCache(): Promise<Map<string, CachedSession>> {
  const db = await openDB()
  const tx = db.transaction(SESSIONS_STORE, 'readonly')
  const all = await promisify(tx.objectStore(SESSIONS_STORE).getAll() as IDBRequest<CachedSession[]>)
  const map = new Map<string, CachedSession>()
  for (const row of all) map.set(row.path, row)
  return map
}

export async function writeSessionCache(entries: CachedSession[], keepPaths: Set<string>): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(SESSIONS_STORE, 'readwrite')
  const store = tx.objectStore(SESSIONS_STORE)
  for (const e of entries) store.put(e)
  // Prune anything we no longer see in the walk.
  const allKeys = await promisify(store.getAllKeys() as IDBRequest<IDBValidKey[]>)
  for (const k of allKeys) {
    if (typeof k === 'string' && !keepPaths.has(k)) store.delete(k)
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Memory cache ──────────────────────────────────────────────────────────────

export async function readMemoryCache(): Promise<Map<string, CachedMemory>> {
  const db = await openDB()
  const tx = db.transaction(MEMORY_STORE, 'readonly')
  const all = await promisify(tx.objectStore(MEMORY_STORE).getAll() as IDBRequest<CachedMemory[]>)
  const map = new Map<string, CachedMemory>()
  for (const row of all) map.set(row.path, row)
  return map
}

export async function writeMemoryCache(entries: CachedMemory[], keepPaths: Set<string>): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(MEMORY_STORE, 'readwrite')
  const store = tx.objectStore(MEMORY_STORE)
  for (const e of entries) store.put(e)
  const allKeys = await promisify(store.getAllKeys() as IDBRequest<IDBValidKey[]>)
  for (const k of allKeys) {
    if (typeof k === 'string' && !keepPaths.has(k)) store.delete(k)
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Root directory handle ─────────────────────────────────────────────────────

const ROOT_HANDLE_KEY = 'rootHandle'

export async function saveRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(META_STORE, 'readwrite')
  tx.objectStore(META_STORE).put({ key: ROOT_HANDLE_KEY, handle })
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB()
    const tx = db.transaction(META_STORE, 'readonly')
    const row = await promisify(tx.objectStore(META_STORE).get(ROOT_HANDLE_KEY) as IDBRequest<{ key: string; handle: FileSystemDirectoryHandle } | undefined>)
    return row?.handle ?? null
  } catch {
    return null
  }
}

export async function clearRootHandle(): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(META_STORE, 'readwrite')
  tx.objectStore(META_STORE).delete(ROOT_HANDLE_KEY)
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Cache maintenance ─────────────────────────────────────────────────────────

export type CacheStats = {
  sessions: number
  memory: number
  hasHandle: boolean
  usageBytes: number | null
  quotaBytes: number | null
}

export async function getCacheStats(): Promise<CacheStats> {
  let sessions = 0
  let memory = 0
  let hasHandle = false
  try {
    const db = await openDB()
    const tx = db.transaction([SESSIONS_STORE, MEMORY_STORE, META_STORE], 'readonly')
    sessions = await promisify(tx.objectStore(SESSIONS_STORE).count() as IDBRequest<number>)
    memory = await promisify(tx.objectStore(MEMORY_STORE).count() as IDBRequest<number>)
    const row = await promisify(tx.objectStore(META_STORE).get(ROOT_HANDLE_KEY) as IDBRequest<{ key: string; handle: FileSystemDirectoryHandle } | undefined>)
    hasHandle = !!row?.handle
  } catch { /* empty / unavailable */ }

  let usageBytes: number | null = null
  let quotaBytes: number | null = null
  try {
    const est = await navigator.storage?.estimate?.()
    usageBytes = est?.usage ?? null
    quotaBytes = est?.quota ?? null
  } catch { /* not supported */ }

  return { sessions, memory, hasHandle, usageBytes, quotaBytes }
}

export async function clearAllCaches(): Promise<void> {
  const db = await openDB()
  const tx = db.transaction([SESSIONS_STORE, MEMORY_STORE, META_STORE], 'readwrite')
  tx.objectStore(SESSIONS_STORE).clear()
  tx.objectStore(MEMORY_STORE).clear()
  tx.objectStore(META_STORE).clear()
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Permission helpers ────────────────────────────────────────────────────────

type PermState = 'granted' | 'denied' | 'prompt'

export async function queryHandlePermission(handle: FileSystemDirectoryHandle): Promise<PermState> {
  try {
    const h = handle as unknown as { queryPermission?: (opts: { mode: 'read' }) => Promise<PermState> }
    if (!h.queryPermission) return 'prompt'
    return await h.queryPermission({ mode: 'read' })
  } catch {
    return 'prompt'
  }
}

export async function requestHandlePermission(handle: FileSystemDirectoryHandle): Promise<PermState> {
  try {
    const h = handle as unknown as { requestPermission?: (opts: { mode: 'read' }) => Promise<PermState> }
    if (!h.requestPermission) return 'prompt'
    return await h.requestPermission({ mode: 'read' })
  } catch {
    return 'denied'
  }
}
