import Field from './Field'
import { formatPhone, onlyDigits } from '../../utils/format'

export default function PhoneField({ label = 'Telefone', value, onChange, error, hint, required, disabled, ...rest }) {
  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      required={required}
      icon="bi-telephone"
      inputMode="tel"
      autoComplete="tel"
      placeholder="(11) 99999-9999"
      value={formatPhone(value)}
      onChange={(event) => onChange(onlyDigits(event.target.value).slice(0, 11))}
      disabled={disabled}
      {...rest}
    />
  )
}
