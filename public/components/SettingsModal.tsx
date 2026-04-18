import React, { useRef, useState } from 'react'
import { RiDownloadLine, RiUploadLine } from 'react-icons/ri'
import { Modal, Button } from '../lib/ds'
import { exportPrefs, importPrefs, type ImportMode, type ImportResult } from '../lib/prefs'

type Status =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; result: ImportResult; mode: ImportMode }

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<ImportMode>('merge')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const fileRef = useRef<HTMLInputElement>(null)

  const handleExport = () => {
    const data = exportPrefs()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `cclens-prefs-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const result = importPrefs(parsed, mode)
      setStatus({ kind: 'success', result, mode })
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleImportFile(f)
  }

  const close = () => {
    setStatus({ kind: 'idle' })
    onClose()
  }

  return (
    <Modal open={open} onClose={close} size="md" title="Settings">
      <Modal.Body className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Bookmarks & notes backup</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Bookmarks, notes, and diff-view preference are stored in this browser's localStorage. Export a JSON backup so they survive browser changes or cleared storage.
          </p>

          <div className="flex flex-col gap-3 mt-2">
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Export</span>
                <span className="text-[11px] text-gray-500 dark:text-gray-500">Download current prefs as JSON.</span>
              </div>
              <Button variant="secondary" size="sm" icon={<RiDownloadLine size={14} />} onClick={handleExport}>
                Export JSON
              </Button>
            </div>

            <div className="flex flex-col gap-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Import</span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-500">Restore a previously exported backup.</span>
                </div>
                <Button variant="secondary" size="sm" icon={<RiUploadLine size={14} />} onClick={() => fileRef.current?.click()}>
                  Choose file…
                </Button>
                <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFileChange} />
              </div>

              <div className="flex items-center gap-3 pl-0.5">
                <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400 cursor-pointer">
                  <input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} className="accent-indigo-600" />
                  Merge (keep existing)
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400 cursor-pointer">
                  <input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="accent-indigo-600" />
                  Replace (wipe then import)
                </label>
              </div>
            </div>
          </div>

          {status.kind === 'error' && (
            <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{status.message}</p>
          )}
          {status.kind === 'success' && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
              {status.mode === 'replace' ? 'Replaced' : 'Merged'} —
              {' '}{status.result.bookmarksAdded} new bookmark{status.result.bookmarksAdded === 1 ? '' : 's'}
              {' '}({status.result.bookmarksTotal} total),
              {' '}{status.result.notesAdded} new note{status.result.notesAdded === 1 ? '' : 's'}
              {status.result.notesUpdated > 0 && `, ${status.result.notesUpdated} updated`}
              {' '}({status.result.notesTotal} total).
            </p>
          )}
        </section>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" size="sm" onClick={close}>Close</Button>
      </Modal.Footer>
    </Modal>
  )
}
