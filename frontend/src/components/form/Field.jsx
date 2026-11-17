import { useId } from 'react'

export function inputClass(error, extra = '') {
  return `form-control fp-input ${error ? 'is-invalid' : ''} ${extra}`.trim()
}

export function selectClass(error, extra = '') {
  return `form-select fp-input ${error ? 'is-invalid' : ''} ${extra}`.trim()
}

/**
 * Generic labelled field. Renders an <input> by default, a <textarea> with
 * `as="textarea"`, or wraps custom controls passed as children.
 */
export default function Field({
  label,
  error,
  hint,
  required = false,
  icon,
  className = '',
  children,
  as = 'input',
  ...props
}) {
  const autoId = useId()
  const id = props.id || (props.name ? `field-${props.name}` : autoId)
  const invalid = Boolean(error)

  let control
  if (children) {
    control = children
  } else if (as === 'textarea') {
    control = <textarea id={id} className={inputClass(error)} rows={3} {...props} />
  } else {
    control = <input id={id} className={inputClass(error)} aria-invalid={invalid} {...props} />
  }

  return (
    <div className={`fp-field ${className}`.trim()}>
      {label && (
        <label htmlFor={children ? undefined : id} className="fp-label">
          {label}
          {required && <span className="fp-required" aria-hidden="true">*</span>}
        </label>
      )}
      <div className={`fp-control ${icon ? 'has-icon' : ''}`.trim()}>
        {icon && <i className={`bi ${icon} fp-control-icon`} aria-hidden="true" />}
        {control}
      </div>
      {error && (
        <span className="fp-field-error" role="alert">
          <i className="bi bi-exclamation-circle-fill" /> {error}
        </span>
      )}
      {!error && hint && <span className="fp-field-hint">{hint}</span>}
    </div>
  )
}
