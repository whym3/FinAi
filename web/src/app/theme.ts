import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const listeners = new Set<() => void>()
const read = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

export function setTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  try { localStorage.setItem('pv-theme', t) } catch { /* private mode: not remembered */ }
  listeners.forEach(l => l())
}

/** Shared theme store; index.html applies the saved theme before first paint. */
export function useTheme() {
  const theme = useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb) } }, read)
  return { theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }
}
