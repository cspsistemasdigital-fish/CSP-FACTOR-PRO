export default function StatCard({ label, value, hint, icon, tone = 'green', footer, loading = false }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-card-top">
        <span className="stat-icon">
          <i className={`bi ${icon || 'bi-graph-up'}`} />
        </span>
        {footer && <span className="stat-footer-pill">{footer}</span>}
      </div>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{loading ? '—' : value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  )
}
