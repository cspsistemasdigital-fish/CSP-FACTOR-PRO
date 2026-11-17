import { useCallback, useEffect, useRef, useState } from 'react'
import { clientsApi } from '../../api'
import { formatBRL, formatDocument, formatPhone } from '../../utils/format'

/**
 * Searchable client picker (combobox) backed by /api/clients/options.
 * onChange receives the full option object (or null when cleared).
 */
export default function ClientSelect({
  label = 'Cliente',
  value,
  onChange,
  initialClient = null,
  error,
  hint,
  required = false,
  disabled = false,
  includeInactive = false,
  placeholder = 'Busque por nome, código ou CPF/CNPJ…',
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [selected, setSelected] = useState(initialClient || null)
  const rootRef = useRef(null)
  const requestRef = useRef(0)

  const loadOptions = useCallback(async (term) => {
    const requestId = ++requestRef.current
    setLoading(true)
    try {
      const { data } = await clientsApi.options(term || '', !includeInactive)
      if (requestRef.current === requestId) {
        setOptions(data.items || [])
        setHighlighted(0)
      }
    } catch {
      if (requestRef.current === requestId) setOptions([])
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [includeInactive])

  useEffect(() => {
    if (!initialClient?.id) return
    setSelected((current) => {
      if (!current || current.id === initialClient.id) {
        return { ...(current || {}), ...initialClient }
      }
      return current
    })
  }, [initialClient])

  // Keep selection in sync with the external value (edit forms / URL filters).
  useEffect(() => {
    if (!value) {
      setSelected(null)
      return
    }
    setSelected((current) => (current && current.id === value ? current : null))
  }, [value])

  useEffect(() => {
    if (!value || selected) return undefined
    let active = true
    ;(async () => {
      try {
        const { data } = await clientsApi.options('', !includeInactive)
        if (!active) return
        const match = (data.items || []).find((item) => item.id === Number(value))
        if (match) setSelected(match)
      } catch {
        /* the field simply stays empty; the user can search again */
      }
    })()
    return () => {
      active = false
    }
  }, [value, selected, includeInactive])

  useEffect(() => {
    if (!open) return undefined
    const timer = setTimeout(() => loadOptions(search), 250)
    return () => clearTimeout(timer)
  }, [open, search, loadOptions])

  useEffect(() => {
    if (!open) return undefined
    const onClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const choose = (option) => {
    setSelected(option)
    onChange?.(option)
    setOpen(false)
    setSearch('')
  }

  const clear = (event) => {
    event.stopPropagation()
    setSelected(null)
    onChange?.(null)
    setSearch('')
    setOpen(true)
  }

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlighted((index) => Math.min(index + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      if (open && options[highlighted]) {
        event.preventDefault()
        choose(options[highlighted])
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const shownValue = open ? search : selected?.name || ''

  return (
    <div className={`fp-field client-select ${error ? 'has-error' : ''}`.trim()} ref={rootRef}>
      {label && (
        <label className="fp-label" htmlFor="client-select-input">
          {label}
          {required && <span className="fp-required" aria-hidden="true">*</span>}
        </label>
      )}
      <div
        className={`client-select-control ${open ? 'open' : ''} ${disabled ? 'disabled' : ''} ${error ? 'is-invalid' : ''}`.trim()}
        onClick={() => !disabled && setOpen(true)}
      >
        <i className="bi bi-person-badge client-select-icon" aria-hidden="true" />
        <input
          id="client-select-input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls="client-select-list"
          aria-autocomplete="list"
          autoComplete="off"
          value={shownValue}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => {
            if (disabled) return
            setOpen(true)
            setSearch('')
          }}
          onChange={(event) => {
            setSearch(event.target.value)
            setOpen(true)
          }}
          onKeyDown={handleKeyDown}
        />
        {selected && !disabled && (
          <button type="button" className="client-select-clear" onClick={clear} aria-label="Limpar cliente">
            <i className="bi bi-x-lg" />
          </button>
        )}
        <i className={`bi bi-chevron-${open ? 'up' : 'down'} client-select-caret`} aria-hidden="true" />
      </div>

      {open && !disabled && (
        <div className="client-select-menu" id="client-select-list" role="listbox">
          {loading && (
            <div className="client-select-status">
              <span className="spinner-border spinner-border-sm" aria-hidden="true" /> Buscando clientes…
            </div>
          )}
          {!loading && options.length === 0 && (
            <div className="client-select-status">
              <i className="bi bi-search" /> Nenhum cliente ativo encontrado.
            </div>
          )}
          {!loading &&
            options.map((option, index) => (
              <button
                type="button"
                key={option.id}
                role="option"
                aria-selected={selected?.id === option.id}
                className={`client-select-option ${index === highlighted ? 'highlighted' : ''}`}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(option)}
              >
                <span className="client-option-avatar">
                  <i className="bi bi-building" />
                </span>
                <span className="client-option-main">
                  <strong>{option.name}</strong>
                  <small>
                    {option.code} · {formatDocument(option.document)}
                    {option.whatsapp ? ` · ${formatPhone(option.whatsapp)}` : ''}
                  </small>
                </span>
                <span className="client-option-side">
                  <small>Disponível</small>
                  <strong className={Number(option.available_limit) < 0 ? 'text-danger' : ''}>
                    {formatBRL(option.available_limit)}
                  </strong>
                </span>
              </button>
            ))}
        </div>
      )}

      {selected && !open && (
        <div className="client-selected-meta">
          <span>{selected.code}</span>
          <span>{formatDocument(selected.document)}</span>
          <span>
            Limite disponível: <strong>{formatBRL(selected.available_limit)}</strong>
          </span>
        </div>
      )}
      {error && (
        <span className="fp-field-error" role="alert">
          <i className="bi bi-exclamation-circle-fill" /> {error}
        </span>
      )}
      {!error && hint && <span className="fp-field-hint">{hint}</span>}
    </div>
  )
}
