export default function Panel({
  title,
  subtitle,
  icon,
  actions,
  children,
  footer,
  className = '',
  padded = true,
}) {
  return (
    <section className={`fp-panel ${className}`.trim()}>
      {(title || actions) && (
        <header className="fp-panel-head">
          <div className="fp-panel-title">
            {icon && (
              <span className="fp-panel-icon">
                <i className={`bi ${icon}`} />
              </span>
            )}
            <div>
              <h3>{title}</h3>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="fp-panel-actions">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'fp-panel-body' : 'fp-panel-body is-flush'}>{children}</div>
      {footer && <footer className="fp-panel-foot">{footer}</footer>}
    </section>
  )
}
