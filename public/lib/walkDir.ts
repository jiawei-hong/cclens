import type { TrackedFile } from './parser'

// Recursively walk a FileSystemDirectoryHandle and collect every .jsonl / .md
// file we care about, keeping its relative path so downstream code can figure
// out which project it belongs to.
export async function walkFolder(
  dir: FileSystemDirectoryHandle,
  base = '',
  out: TrackedFile[] = [],
): Promise<TrackedFile[]> {
  for await (const [, handle] of dir) {
    const path = base ? `${base}/${handle.name}` : handle.name
    if (handle.kind === 'directory') {
      await walkFolder(handle as FileSystemDirectoryHandle, path, out)
    } else {
      const name = handle.name
      if (name.endsWith('.jsonl') || name.endsWith('.md')) {
        out.push({ file: await (handle as FileSystemFileHandle).getFile(), path })
      }
    }
  }
  return out
}
