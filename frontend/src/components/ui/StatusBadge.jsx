import { statusMeta } from '../../utils/format'

export default function StatusBadge({ status, overdue = false, size = 'md' }) {
  const meta = statusMeta(status, overdue)
  return (
    <span className={`fp-badge fp-badge-${meta.variant} fp-badge-${size}`}>
      <i className={`bi ${meta.icon}`} />
      {meta.label}
    </span>
  )
}
