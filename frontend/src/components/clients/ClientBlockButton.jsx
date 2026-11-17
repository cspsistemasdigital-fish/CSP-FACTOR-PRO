import { useState } from 'react'
import { clientsApi } from '../../api'
import { apiError } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import Field from '../form/Field'
import Modal from '../ui/Modal'
import ConfirmDialog from '../ui/ConfirmDialog'
import { formatBRL } from '../../utils/format'

/**
 * Manual, audited block for delinquent clients. The system only detects overdue
 * documents; the human decides whether to block new postings.
 */
export default function ClientBlockButton({ clientId, blocked, reason, overdue, onChanged }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [unblockOpen, setUnblockOpen] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const overdueCount = Number(overdue?.overdue_documents || 0)
  const canBlock = overdueCount > 0

  const submit = async () => {
    if (!blocked && !blockReason.trim()) {
      setError('Informe o motivo do bloqueio.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { data } = await clientsApi.setBlocked(
        clientId,
        !blocked,
        blocked ? '' : blockReason.trim(),
      )
      toast.success(
        blocked ? 'Cliente desbloqueado' : 'Cliente bloqueado',
        data.message,
      )
      setOpen(false)
      setUnblockOpen(false)
      setBlockReason('')
      onChanged?.(data.item)
    } catch (requestError) {
      const parsed = apiError(requestError)
      setError(parsed.errors?.reason || parsed.errors?.blocked || parsed.message)
    } finally {
      setSaving(false)
    }
  }

  if (!blocked && !canBlock) return null

  const summary = overdueCount
    ? `${overdueCount} título(s) vencido(s), totalizando ${formatBRL(overdue.overdue_amount)}.`
    : ''

  return (
    <>
      <button
        type="button"
        className={`btn ${blocked ? 'btn-outline-secondary' : 'btn-outline-danger'}`}
        onClick={() => (blocked ? setUnblockOpen(true) : setOpen(true))}
      >
        <i className={`bi ${blocked ? 'bi-unlock' : 'bi-lock'}`} />
        {blocked ? ' Desbloquear' : ' Bloquear por inadimplência'}
      </button>

      <Modal
        open={open}
        onClose={saving ? () => {} : () => setOpen(false)}
        title="Bloquear cliente por inadimplência"
        icon="bi-exclamation-triangle-fill"
        footer={
          <>
            <button type="button" className="btn btn-light" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn btn-danger" onClick={submit} disabled={saving}>
              {saving && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
              Bloquear cliente
            </button>
          </>
        }
      >
        <div className="alert alert-warning fp-alert" role="alert">
          <i className="bi bi-exclamation-triangle-fill" />
          <div>
            <strong>Confirme a decisão.</strong> {summary} Novos cheques, boletos e operações serão
            recusados para este cliente. Recebimentos e edições de títulos existentes continuam
            permitidos. O bloqueio é registrado na auditoria.
          </div>
        </div>
        <Field
          label="Motivo do bloqueio"
          name="block_reason"
          as="textarea"
          rows={3}
          value={blockReason}
          onChange={(event) => {
            setBlockReason(event.target.value)
            setError('')
          }}
          error={error}
          maxLength={255}
          hint="Ex.: 3 cheques vencidos há mais de 30 dias, sem acordo confirmado."
          required
        />
      </Modal>

      <ConfirmDialog
        open={unblockOpen}
        title="Desbloquear cliente?"
        message={`O cliente voltará a aceitar novos cheques, boletos e operações. ${summary} Motivo atual: ${reason || 'não informado'}. O desbloqueio será registrado na auditoria.`}
        confirmLabel="Desbloquear cliente"
        tone="primary"
        loading={saving}
        onCancel={() => setUnblockOpen(false)}
        onConfirm={submit}
      />
    </>
  )
}
