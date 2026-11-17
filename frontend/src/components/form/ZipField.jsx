import Field from './Field'
import { formatZip, onlyDigits } from '../../utils/format'

export default function ZipField({ label = 'CEP', value, onChange, error, hint, required, disabled }) {
  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      required={required}
      icon="bi-geo-alt"
      inputMode="numeric"
      autoComplete="postal-code"
      placeholder="00000-000"
      value={formatZip(value)}
      onChange={(event) => onChange(onlyDigits(event.target.value).slice(0, 8))}
      disabled={disabled}
    />
  )
}
