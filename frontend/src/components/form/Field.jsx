import { Children, cloneElement, isValidElement, useId } from 'react'

export function inputClass(error, extra = '') {
  return `form-control fp-input ${error ? 'is-invalid' : ''} ${extra}`.trim()
}

export function selectClass(error, extra = '') {
  return `form-select fp-input ${error ? 'is-invalid' : ''} ${extra}`.trim()
}

const LABELABLE_TAGS = new Set(['input', 'select', 'textarea', 'button'])

function applyControlAttrs(element, { id, describedBy, invalid }) {
  const controlId = element.props.id || id
  return {
    id: controlId,
    node: cloneElement(element, {
      id: controlId,
      'aria-describedby': element.props['aria-describedby'] || describedBy,
      'aria-invalid': element.props['aria-invalid'] ?? invalid,
    }),
  }
}

/**
 * Children can be a raw control, a wrapper <label> or a chain of wrappers.
 * Walk the explicit element tree and annotate only the first labelable
 * control, leaving the rest of the markup untouched.
 */
function associateFirstControl(node, attrs) {
  if (!isValidElement(node)) return { node, changed: false, id: attrs.id }

  const isFragment = typeof node.type === 'symbol'
  if (isFragment || node.props.children != null) {
    let changed = false
    let id = attrs.id
    const children = Children.map(node.props.children, (child) => {
      if (changed) return child
      const result = associateFirstControl(child, attrs)
      if (result.changed) {
        changed = true
        id = result.id
        return result.node
      }
      return child
    })
    if (changed) {
      return { node: cloneElement(node, undefined, children), changed: true, id }
    }
  }

  if (typeof node.type === 'string') {
    if (!LABELABLE_TAGS.has(node.type)) return { node, changed: false, id: attrs.id }
    const result = applyControlAttrs(node, attrs)
    return { node: result.node, changed: true, id: result.id }
  }

  // Custom components are assumed to render and forward props to a control.
  const result = applyControlAttrs(node, attrs)
  return { node: result.node, changed: true, id: result.id }
}

/**
 * Generic labelled field. Renders an <input> by default, a <textarea> with
 * `as="textarea"`, or wraps custom controls passed as children.
 *
 * The label is always associated with the control (useId when there is no
 * `name`) and hint/error messages are linked through aria-describedby.
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
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = error ? errorId : hint ? hintId : undefined
  const attrs = { id, describedBy, invalid }

  let control
  let controlId = id
  if (children) {
    control = children
    if (isValidElement(control)) {
      const result = associateFirstControl(control, attrs)
      control = result.node
      controlId = result.id
    }
  } else if (as === 'textarea') {
    control = (
      <textarea
        {...props}
        id={id}
        className={inputClass(error)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        rows={props.rows || 3}
      />
    )
  } else {
    control = (
      <input
        {...props}
        id={id}
        className={inputClass(error)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    )
  }

  return (
    <div className={`fp-field ${className}`.trim()}>
      {label && (
        <label htmlFor={controlId} className="fp-label">
          {label}
          {required && <span className="fp-required" aria-hidden="true">*</span>}
        </label>
      )}
      <div className={`fp-control ${icon ? 'has-icon' : ''}`.trim()}>
        {icon && <i className={`bi ${icon} fp-control-icon`} aria-hidden="true" />}
        {control}
      </div>
      {error && (
        <span id={errorId} className="fp-field-error" role="alert">
          <i className="bi bi-exclamation-circle-fill" /> {error}
        </span>
      )}
      {!error && hint && <span id={hintId} className="fp-field-hint">{hint}</span>}
    </div>
  )
}
