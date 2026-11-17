export const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export const BRLCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatBRL(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 'R$ 0,00'
  return BRL.format(number)
}

export function formatCompact(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 'R$ 0,00'
  return Math.abs(number) >= 1000000 ? BRLCompact.format(number) : BRL.format(number)
}

export function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value) || 0)
}

export function formatDate(value) {
  if (!value) return '—'
  const text = String(value)
  const datePart = text.length > 10 ? text.slice(0, 10) : text
  const [year, month, day] = datePart.split('-')
  if (!year || !month || !day) return text
  return `${day}/${month}/${year}`
}

export function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return formatDate(value)
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function todayISO() {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  const local = new Date(now.getTime() - offset * 60 * 1000)
  return local.toISOString().slice(0, 10)
}

export function addDaysISO(days, from = new Date()) {
  const date = new Date(from)
  date.setDate(date.getDate() + days)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 10)
}

export function monthRange(offsetMonths = 0) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0)
  const local = (date) => {
    const offset = date.getTimezoneOffset()
    return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 10)
  }
  return { from: local(first), to: local(last) }
}

export function presetRange(preset) {
  const today = todayISO()
  switch (preset) {
    case 'hoje':
      return { from: today, to: today }
    case 'ontem': {
      const yesterday = addDaysISO(-1)
      return { from: yesterday, to: yesterday }
    }
    case '7d':
      return { from: addDaysISO(-6), to: today }
    case '30d':
      return { from: addDaysISO(-29), to: today }
    case 'mes_atual': {
      const { from, to } = monthRange(0)
      return { from, to: to > today ? today : to }
    }
    case 'mes_anterior':
      return monthRange(-1)
    case 'ano_atual':
      return { from: `${new Date().getFullYear()}-01-01`, to: today }
    default:
      return { from: '', to: '' }
  }
}

export function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '')
}

export function onlyAlphanumeric(value) {
  return String(value || '').replace(/[^0-9a-zA-Z]/g, '').toUpperCase()
}

export function formatDocument(value) {
  if (!value) return ''
  const raw = onlyAlphanumeric(value)
  if (raw.length <= 11) {
    const digits = onlyDigits(raw)
    if (digits.length !== raw.length) return raw
    return digits
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1-$2')
      .slice(0, 14)
  }
  const trimmed = raw.slice(0, 14)
  let out = trimmed
  out = out.replace(/^(\w{2})(\w)/, '$1.$2')
  out = out.replace(/^(\w{2})\.(\w{3})(\w)/, '$1.$2.$3')
  out = out.replace(/^(\w{2})\.(\w{3})\.(\w{3})(\w)/, '$1.$2.$3/$4')
  out = out.replace(/\/(\w{4})(\w)/, '/$1-$2')
  return out
}

export function formatPhone(value) {
  const digits = onlyDigits(value).slice(0, 11)
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

export function formatZip(value) {
  const digits = onlyDigits(value).slice(0, 8)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

export function formatBarcode(value) {
  const digits = onlyDigits(value)
  return digits.replace(/(\d{5})(?=\d)/g, '$1 ').trim()
}

export function maskCurrencyInput(text) {
  const digits = onlyDigits(text)
  if (!digits) return ''
  const number = Number(digits) / 100
  return number.toFixed(2)
}

export function currencyToInput(value) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return number.toFixed(2)
}

export function displayCurrencyInput(value) {
  const input = currencyToInput(value)
  if (input === '') return ''
  return formatBRL(Number(input))
}

export function digitsToCurrency(digits) {
  if (!digits) return ''
  return (Number(digits) / 100).toFixed(2)
}

export const DOCUMENT_STATUS_OPTIONS = [
  { value: 'EM_ABERTO', label: 'Em aberto' },
  { value: 'LIQUIDADO', label: 'Liquidado' },
  { value: 'DEVOLVIDO', label: 'Devolvido' },
  { value: 'CANCELADO', label: 'Cancelado' },
]

export function statusMeta(status, overdue = false) {  if (status === 'EM_ABERTO' && overdue) {
    return { label: 'Vencido', variant: 'danger', icon: 'bi-exclamation-triangle-fill' }
  }
  switch (status) {
    case 'EM_ABERTO':
      return { label: 'Em aberto', variant: 'warning', icon: 'bi-clock-fill' }
    case 'LIQUIDADO':
      return { label: 'Liquidado', variant: 'success', icon: 'bi-check-circle-fill' }
    case 'DEVOLVIDO':
      return { label: 'Devolvido', variant: 'danger', icon: 'bi-arrow-return-left' }
    case 'CANCELADO':
      return { label: 'Cancelado', variant: 'neutral', icon: 'bi-slash-circle' }
    case 'ATIVO':
      return { label: 'Ativo', variant: 'success', icon: 'bi-check-circle-fill' }
    case 'INATIVO':
      return { label: 'Inativo', variant: 'neutral', icon: 'bi-pause-circle' }
    case 'ABERTA':
      return { label: 'Aberta', variant: 'warning', icon: 'bi-folder2-open' }
    case 'FECHADA':
      return { label: 'Fechada', variant: 'success', icon: 'bi-lock-fill' }
    default:
      return { label: status || '—', variant: 'neutral', icon: 'bi-circle' }
  }
}

export function initials(name) {
  return String(name || '?')
    .replace(/\[DEMO\]/gi, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export function nameWithoutDemo(name) {
  return String(name || '').replace(/^\[DEMO\]\s*/i, '')
}

export function describePeriod(from, to) {
  if (!from && !to) return 'Todo o período'
  if (from && to && from === to) return formatDate(from)
  if (from && to) return `${formatDate(from)} a ${formatDate(to)}`
  if (from) return `A partir de ${formatDate(from)}`
  return `Até ${formatDate(to)}`
}
