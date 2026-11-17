import { useBrand } from '../context/BrandContext'

export function LogoMark({ size = 40, className = '', src = null, label = null }) {
  const { logoUrl, appName } = useBrand()
  const imageSrc = src || logoUrl

  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        width={size}
        height={size}
        className={className}
        style={{ objectFit: 'contain' }}
        role="img"
        alt={label || appName}
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
      aria-label={label || appName}
    >
      <rect width="64" height="64" rx="14" fill="#123D32" />
      <rect x="16" y="17" width="9" height="30" rx="2" fill="#FFFFFF" />
      <rect x="16" y="17" width="24" height="7" rx="2" fill="#FFFFFF" />
      <rect x="16" y="28" width="17" height="6" rx="2" fill="#DDF4E8" />
      <rect x="36" y="38" width="5" height="9" rx="2" fill="#7FD3AC" />
      <rect x="43" y="32" width="5" height="15" rx="2" fill="#DDF4E8" />
      <rect x="50" y="25" width="5" height="22" rx="2" fill="#16845B" />
    </svg>
  )
}

export default function Logo({
  size = 38,
  showSubtitle = true,
  light = false,
  name = null,
  subtitle = null,
  src = null,
}) {
  const { appName } = useBrand()
  const displayName = name || appName

  return (
    <div className={`fp-logo ${light ? 'fp-logo-light' : ''}`}>
      <LogoMark size={size} src={src} label={displayName} />
      <div className="fp-logo-text">
        <span className="fp-logo-name">{displayName}</span>
        {showSubtitle && (
          <span className="fp-logo-sub">{subtitle || 'Gestão Financeira Inteligente'}</span>
        )}
      </div>
    </div>
  )
}
