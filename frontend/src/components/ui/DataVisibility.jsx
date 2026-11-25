import { useState } from 'react'

export default function DataVisibility({ id, label, children }) {
  const [visible, setVisible] = useState(false)
  const action = visible ? 'Ocultar' : 'Mostrar'
  const accessibleLabel = `${action} dados salvos de ${label}`

  return (
    <div className="fp-data-visibility">
      <div className="fp-data-visibility-action">
        <button
          type="button"
          className="btn fp-data-visibility-button"
          aria-label={accessibleLabel}
          aria-expanded={visible}
          aria-controls={id}
          title={accessibleLabel}
          onClick={() => setVisible((current) => !current)}
        >
          <i className={`bi ${visible ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" />
        </button>
      </div>
      <div id={id} hidden={!visible}>
        {visible ? children : null}
      </div>
    </div>
  )
}
