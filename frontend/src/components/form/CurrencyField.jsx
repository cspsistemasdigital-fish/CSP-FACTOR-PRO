import Field from './Field'
import { digitsToCurrency, displayCurrencyInput, onlyDigits } from '../../utils/format'

/**
 * Currency input with the classic "digits only" BRL mask.
 * The value is always handled as a numeric string (e.g. "1234.56"),
 * never turned into automatic interest/discount calculations.
 */
export default function CurrencyField({ label, value, onChange, hint, error, required, disabled, ...rest }) {
  const handleChange = (event) => {
    const digits = onlyDigits(event.target.value).slice(0, 14)
    onChange(digits ? digitsToCurrency(digits) : '')
  }

  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      required={required}
      inputMode="numeric"
      autoComplete="off"
      placeholder="R$ 0,00"
      value={displayCurrencyInput(value)}
      onChange={handleChange}
      disabled={disabled}
      {...rest}
    />
  )
}
