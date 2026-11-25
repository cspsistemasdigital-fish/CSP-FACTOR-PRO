import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { alertsApi } from '../../api'
import { useToast } from '../../context/ToastContext'
import { formatBRL } from '../../utils/format'

const DISMISS_KEY = 'factorpro-alerts-dismissed'
let startupToastShown = false

/** Persistent overdue notice, shown on every app open until dismissed in this session. */
export default function GlobalAlerts() {
  const toast = useToast()
  const [alerts, setAlerts] = useState(null)
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === '1',
  )

  useEffect(() => {
    let active = true
    alertsApi
      .list()
      .then(({ data }) => {
        if (!active) return
        setAlerts(data)
        if (data.client_count > 0 && !startupToastShown) {
          startupToastShown = true
          const count = data.overdue_count ?? data.document_count
          const countLabel = count === 1 ? 'item vencido' : 'itens vencidos'
          toast.warning(
            'Clientes inadimplentes',
            `${data.client_count} cliente(s), ${count} ${countLabel} · ${formatBRL(data.total_amount)}`,
          )
        }
      })
      .catch(() => {
        /* the banner is advisory: never block the application if it fails */
      })
    return () => {
      active = false
    }
  }, [toast])

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  const overdueCount = alerts?.overdue_count ?? alerts?.document_count ?? 0
  const overdueLabel = overdueCount === 1 ? 'item vencido' : 'itens vencidos'

  if (!alerts || alerts.client_count === 0 || dismissed) return null

  return (
    <div className="fp-global-alerts" role="status" aria-live="polite">
      <span className="fp-global-alerts-icon" aria-hidden="true">
        <i className="bi bi-exclamation-triangle-fill" />
      </span>
      <div className="fp-global-alerts-body">
        <strong>
          {alerts.client_count} cliente(s) inadimplente(s) · {formatBRL(alerts.total_amount)} em atraso
        </strong>
        <span>
          {overdueCount} {overdueLabel}. O sistema apenas informa: a decisão de
          bloquear novos lançamentos é sua.
        </span>
      </div>
      <Link className="fp-global-alerts-link" to="/clientes?overdue=1">
        Ver clientes <i className="bi bi-arrow-right" />
      </Link>
      <button
        type="button"
        className="fp-global-alerts-close"
        onClick={dismiss}
        aria-label="Dispensar aviso de inadimplentes"
        title="Dispensar aviso"
      >
        <i className="bi bi-x-lg" />
      </button>
    </div>
  )
}
