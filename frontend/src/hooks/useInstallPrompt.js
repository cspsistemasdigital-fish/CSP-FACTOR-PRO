import { useEffect, useState } from 'react'

/* iOS Safari não dispara beforeinstallprompt e expõe navigator.standalone. */
function isRunningStandalone() {
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)').matches ||
      window.matchMedia?.('(display-mode: minimal-ui)').matches ||
      window.navigator?.standalone,
  )
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [installed, setInstalled] = useState(isRunningStandalone)

  useEffect(() => {
    const onBeforeInstall = (event) => {
      event.preventDefault()
      setDeferredPrompt(event)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
    }
    const syncStandalone = () => {
      if (isRunningStandalone()) setInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('pageshow', syncStandalone)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('pageshow', syncStandalone)
    }
  }, [])

  const install = async () => {
    if (!deferredPrompt) return null
    deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    return choice
  }

  return { canInstall: Boolean(deferredPrompt) && !installed, install, installed }
}
