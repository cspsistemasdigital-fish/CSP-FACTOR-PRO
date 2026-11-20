import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import api from '../api/client'

const DEFAULT_BRAND = {
  app_name: 'FACTOR PRO',
  company_name: 'FACTOR PRO',
  has_logo: false,
  logo_url: null,
}

const FALLBACK = {
  appName: 'FACTOR PRO',
  companyName: 'FACTOR PRO',
  logoUrl: null,
  hasLogo: false,
  refreshBrand: async () => {},
}

const BrandContext = createContext(null)

/** Public branding (no Bearer token): name + logo shared by the shell and PWA. */
export function BrandProvider({ children }) {
  const [brand, setBrand] = useState(DEFAULT_BRAND)

  const refreshBrand = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/brand')
      setBrand({ ...DEFAULT_BRAND, ...data, logo_url: data.logo_url || null })
    } catch {
      // Settings may be unavailable on a cold start; keep the built-in identity.
    }
  }, [])

  useEffect(() => {
    refreshBrand()
  }, [refreshBrand])

  useEffect(() => {
    const appName = brand.app_name || DEFAULT_BRAND.app_name
    document.title = `${appName} | Gestão Financeira Inteligente`

    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    if (appleTitle) appleTitle.setAttribute('content', appName)

    const description = document.querySelector('meta[name="description"]')
    if (description) {
      description.setAttribute(
        'content',
        `${appName} — gestão financeira inteligente de cheques, boletos e operações de factoring.`,
      )
    }

    let favicon = document.querySelector('link[rel="icon"]')
    if (!favicon) {
      favicon = document.createElement('link')
      favicon.rel = 'icon'
      document.head.appendChild(favicon)
    }
    favicon.href = '/api/settings/brand/favicon'
    favicon.removeAttribute('type')

    let manifest = document.querySelector('link[rel="manifest"]')
    if (!manifest) {
      manifest = document.createElement('link')
      manifest.rel = 'manifest'
      document.head.appendChild(manifest)
    }
    manifest.href = '/api/settings/brand/manifest.webmanifest'
  }, [brand.app_name])

  const value = useMemo(
    () => ({
      appName: brand.app_name || DEFAULT_BRAND.app_name,
      companyName: brand.company_name || DEFAULT_BRAND.company_name,
      logoUrl: brand.logo_url || null,
      hasLogo: Boolean(brand.has_logo),
      refreshBrand,
    }),
    [brand, refreshBrand],
  )

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
}

export function useBrand() {
  return useContext(BrandContext) || FALLBACK
}

export default BrandContext
