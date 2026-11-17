import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const ThemeContext = createContext(null)

/* Cores da cromática do navegador por tema (paleta marfim / verde profundo). */
const CHROME_COLORS = {
  light: '#F5F1E8',
  dark: '#101B1A',
}

function initialTheme() {
  const stored = localStorage.getItem('factorpro-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)

    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', CHROME_COLORS[theme])

    /* No iOS o status bar claro combina com o marfim; no escuro, translúcido. */
    const statusBar = document.querySelector(
      'meta[name="apple-mobile-web-app-status-bar-style"]',
    )
    if (statusBar) {
      statusBar.setAttribute('content', theme === 'dark' ? 'black-translucent' : 'default')
    }

    localStorage.setItem('factorpro-theme', theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  const value = useMemo(() => ({ theme, setTheme, toggle, isDark: theme === 'dark' }), [theme, toggle])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme deve ser usado dentro de ThemeProvider')
  return context
}
