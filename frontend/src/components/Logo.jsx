import { useBrand } from '../context/BrandContext'

export function LogoMark({ size = 40, className = '' }) {
  const { logoUrl, appName } = useBrand()

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={appName}
        width={size}
        height={size}
        className={`fp-logo-image ${className}`}
      />
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={appName}
    >
      <rect width="64" height="64" rx="14" fill="#123D32" />
      <rect x="16" y="17" width="9" height="30" rx="2" fill="#FFFCF5" />
      <rect x="16" y="17" width="24" height="7" rx="2" fill="#FFFCF5" />
      <rect x="16" y="28" width="17" height="6" rx="2" fill="#EFE3CC" />
      <rect x="36" y="38" width="5" height="9" rx="2" fill="#C9A24A" />
      <rect x="43" y="32" width="5" height="15" rx="2" fill="#EFE3CC" />
      <rect x="50" y="25" width="5" height="22" rx="2" fill="#2FA473" />
    </svg>
  )
}

export default function Logo({ size = 38, showSubtitle = true, light = false, name }) {
  const { appName } = useBrand()

  return (
    <div className={`fp-logo ${light ? 'fp-logo-light' : ''}`}>
      <LogoMark size={size} />
      <div className="fp-logo-text">
        <span className="fp-logo-name">{name || appName}</span>
        {showSubtitle && <span className="fp-logo-sub">Gestão Financeira Inteligente</span>}
      </div>
    </div>
  )
}
