import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api from '../api/client'

const BrandContext = createContext(null)

export const DEFAULT_BRAND = {
  app_name: 'FACTOR PRO',
  short_name: 'FACTOR PRO',
  logo_url: null,
  logo_name: '',
  logo_version: '',
  theme_color: '#F5F1E8',
  background_color: '#F5F1E8',
}

/** Public identity: available on the login screen, before any token exists. */
export function BrandProvider({ children }) {
  const [brand, setBrand] = useState(DEFAULT_BRAND)

  const refreshBrand = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/brand')
      if (data?.brand) setBrand({ ...DEFAULT_BRAND, ...data.brand })
    } catch {
      /* the built-in identity remains available offline */
    }
  }, [])

  useEffect(() => {
    refreshBrand()
  }, [refreshBrand])

  useEffect(() => {
    document.title = `${brand.app_name} | Gestão Financeira Inteligente`
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    if (appleTitle) appleTitle.setAttribute('content', brand.short_name || brand.app_name)
  }, [brand])

  const value = useMemo(
    () => ({
      brand,
      appName: brand.app_name,
      logoUrl: brand.logo_url,
      refreshBrand,
    }),
    [brand, refreshBrand],
  )

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
}

export function useBrand() {
  const context = useContext(BrandContext)
  if (!context) throw new Error('useBrand deve ser usado dentro de BrandProvider')
  return context
}
