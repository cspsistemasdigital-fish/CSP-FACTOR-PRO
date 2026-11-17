export default function PageHeader({ title, subtitle, icon, children, badge }) {
  return (
    <div className="page-head">
      <div className="page-head-main">
        {icon && (
          <span className="page-head-icon">
            <i className={`bi ${icon}`} />
          </span>
        )}
        <div>
          <div className="page-head-title-row">
            <h2>{title}</h2>
            {badge}
          </div>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {children && <div className="page-head-actions">{children}</div>}
    </div>
  )
}
