export default function SummaryTile({ label, value, hint, icon, tone = 'green' }) {
  return (
    <div className={`summary-tile tone-${tone}`}>
      <span className="summary-tile-icon">
        <i className={`bi ${icon || 'bi-calculator'}`} />
      </span>
      <div>
        <span className="summary-tile-label">{label}</span>
        <strong className="summary-tile-value">{value}</strong>
        {hint && <span className="summary-tile-hint">{hint}</span>}
      </div>
    </div>
  )
}
