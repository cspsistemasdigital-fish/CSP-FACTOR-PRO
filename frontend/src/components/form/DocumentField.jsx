import Field from './Field'
import { formatDocument, onlyAlphanumeric } from '../../utils/format'

export default function DocumentField({ label = 'CPF / CNPJ', value, onChange, error, hint, required, disabled }) {
  return (
    <Field
      label={label}
      error={error}
      hint={hint || 'Aceita CPF (11 dígitos) e CNPJ (14 caracteres, inclusive alfanumérico).'}
      required={required}
      icon="bi-card-text"
      autoComplete="off"
      placeholder="000.000.000-00 ou 00.000.000/0000-00"
      value={formatDocument(value)}
      onChange={(event) => onChange(onlyAlphanumeric(event.target.value).slice(0, 14))}
      disabled={disabled}
    />
  )
}
