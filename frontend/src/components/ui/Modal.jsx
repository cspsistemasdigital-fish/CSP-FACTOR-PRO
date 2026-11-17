import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
}) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('no-scroll')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('no-scroll')
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fp-modal-root" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="fp-modal-backdrop"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div className={`fp-modal fp-modal-${size}`}>
        <header className="fp-modal-head">
          <div className="fp-modal-title">
            {icon && (
              <span className="fp-modal-icon">
                <i className={`bi ${icon}`} />
              </span>
            )}
            <div>
              <h3>{title}</h3>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <div className="fp-modal-body">{children}</div>
        {footer && <footer className="fp-modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
