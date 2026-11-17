import { useRef, useState } from 'react'

const DEFAULT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp'

function extensionOf(name) {
  return String(name || '').split('.').pop()?.toLowerCase() || ''
}

export function formatFileSize(bytes) {
  const size = Number(bytes) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Attachment picker with client-side type/size validation.
 * The backend validates again (magic bytes + 10 MB limit).
 */
export default function FileField({
  label = 'Anexo',
  accept = DEFAULT_ACCEPT,
  maxMb = 10,
  value,
  onChange,
  disabled = false,
  hint,
}) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  const allowed = accept.split(',').map((item) => item.trim().replace('.', '').toLowerCase())

  const validate = (file) => {
    if (!file) return ''
    if (!allowed.includes(extensionOf(file.name))) {
      return `Formato não permitido. Use ${allowed.join(', ').toUpperCase()}.`
    }
    if (file.size > maxMb * 1024 * 1024) {
      return `Arquivo muito grande. Limite de ${maxMb} MB.`
    }
    return ''
  }

  const pick = (file) => {
    const problem = validate(file)
    setError(problem)
    if (problem) {
      onChange?.(null)
      return
    }
    onChange?.(file)
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    pick(event.dataTransfer.files?.[0] || null)
  }

  return (
    <div className="fp-field">
      {label && <span className="fp-label">{label}</span>}
      <div
        className={`file-drop ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''} ${error ? 'has-error' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(event) => {
          if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="visually-hidden"
          disabled={disabled}
          onChange={(event) => {
            pick(event.target.files?.[0] || null)
            event.target.value = ''
          }}
        />
        <span className="file-drop-icon">
          <i className={`bi ${value ? 'bi-file-earmark-check-fill' : 'bi-cloud-arrow-up-fill'}`} />
        </span>
        {value ? (
          <div className="file-drop-body">
            <strong>{value.name}</strong>
            <small>{formatFileSize(value.size)} · clique para trocar o arquivo</small>
          </div>
        ) : (
          <div className="file-drop-body">
            <strong>Selecionar ou arrastar arquivo</strong>
            <small>PDF, JPG, PNG ou WEBP · até {maxMb} MB</small>
          </div>
        )}
        {value && !disabled && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Remover arquivo selecionado"
            onClick={(event) => {
              event.stopPropagation()
              setError('')
              onChange?.(null)
            }}
          >
            <i className="bi bi-x-lg" />
          </button>
        )}
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
