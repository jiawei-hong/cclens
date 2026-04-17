import { useEffect, useRef } from 'react'

// useEscapeKey — call `cb()` when Escape is pressed while `active`.
export function useEscapeKey(active: boolean, cb: () => void) {
  useEffect(() => {
    if (!active) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') cb() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [active, cb])
}

// useScrollLock — prevent the document from scrolling while `active`.
// Preserves the current scroll position by setting position:fixed on body.
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const { body } = document
    const prevOverflow = body.style.overflow
    body.style.overflow = 'hidden'
    return () => { body.style.overflow = prevOverflow }
  }, [active])
}

// useFocusTrap — keep keyboard focus inside the returned ref'd element while
// `active`. Saves the previously-focused element on activation and restores
// it on deactivation. Falls back gracefully if the container has no
// focusable children.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (!root) return

    const prevActive = document.activeElement as HTMLElement | null
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null)

    // Focus the first focusable on mount (or the container itself as fallback).
    const first = focusables()[0]
    if (first) first.focus()
    else root.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) { e.preventDefault(); return }
      const firstEl = list[0]!
      const lastEl = list[list.length - 1]!
      const current = document.activeElement as HTMLElement | null
      if (e.shiftKey && current === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && current === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    root.addEventListener('keydown', onKey)
    return () => {
      root.removeEventListener('keydown', onKey)
      if (prevActive && typeof prevActive.focus === 'function') prevActive.focus()
    }
  }, [active])

  return ref
}
