export default function EmptyState({ icon = 'bi-inbox', title, message, children }) {
  return (
    <div className="fp-empty">
      <span className="fp-empty-icon">
        <i className={`bi ${icon}`} />
      </span>
      <h4>{title}</h4>
      {message && <p>{message}</p>}
      {children && <div className="fp-empty-actions">{children}</div>}
    </div>
  )
}
