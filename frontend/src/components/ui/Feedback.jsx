export function LoadingBlock({ label = 'Carregando informações…' }) {
  return (
    <div className="fp-loading" role="status">
      <span className="spinner-border" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function InlineSpinner({ label }) {
  return (
    <span className="inline-loading">
      <span className="spinner-border spinner-border-sm" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  )
}

export function ErrorBlock({ message, onRetry }) {
  return (
    <div className="fp-error-block" role="alert">
      <i className="bi bi-wifi-off" />
      <div>
        <strong>Não foi possível carregar os dados</strong>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  )
}
