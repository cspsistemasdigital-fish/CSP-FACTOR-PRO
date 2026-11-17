import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clientsApi } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import PageHeader from '../../components/ui/PageHeader'
import Panel from '../../components/ui/Panel'
import SummaryTile from '../../components/ui/SummaryTile'
import StatusBadge from '../../components/ui/StatusBadge'
import DocumentsTable from '../../components/documents/DocumentsTable'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import EmptyState from '../../components/ui/EmptyState'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import {
  formatBRL,
  formatDate,
  formatDateTime,
  formatDocument,
  formatPhone,
} from '../../utils/format'

const TABS = [
  { key: 'abertos', label: 'Em aberto', icon: 'bi-hourglass-split' },
  { key: 'documentos', label: 'Todos os documentos', icon: 'bi-folder2' },
  { key: 'historico', label: 'Histórico', icon: 'bi-clock-history' },
]

function whatsappLink(phone) {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length < 10) return null
  return `https://wa.me/55${digits}`
}

function actionMeta(action) {
  switch (action) {
    case 'CREATE':
      return { label: 'Criação', variant: 'success' }
    case 'UPDATE':
      return { label: 'Atualização', variant: 'warning' }
    case 'DELETE':
      return { label: 'Exclusão', variant: 'danger' }
    default:
      return { label: action || 'Evento', variant: 'neutral' }
  }
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { canWrite, isAdmin } = useAuth()
  const [client, setClient] = useState(null)
  const [history, setHistory] = useState(null)
  const [tab, setTab] = useState('abertos')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [clientResponse, historyResponse] = await Promise.all([
        clientsApi.get(id),
        clientsApi.history(id),
      ])
      setClient(clientResponse.data.item)
      setHistory(historyResponse.data)
    } catch (requestError) {
      setError(apiError(requestError).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const remove = async () => {
    setDeleting(true)
    try {
      await clientsApi.remove(id)
      toast.success('Cliente excluído', 'Exclusão lógica registrada na auditoria.')
      navigate('/clientes', { replace: true })
    } catch (requestError) {
      const parsed = apiError(requestError)
      const detail = parsed.errors?.client || parsed.message
      toast.error('Não foi possível excluir', detail)
      setConfirmOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Carregando cliente…" />
      </div>
    )
  }

  if (error || !client) {
    return (
      <div className="page">
        <ErrorBlock message={error || 'Cliente não encontrado.'} onRetry={load} />
      </div>
    )
  }

  const summary = client.summary || {}
  const openDocuments = history?.open_documents || []
  const allDocuments = history?.documents || []
  const timeline = history?.timeline || []
  const wa = whatsappLink(client.whatsapp || client.phone)
  const percent = summary.limit_usage_percent

  return (
    <div className="page">
      <PageHeader
        title={client.name}
        subtitle={`${client.code} · ${client.person_type === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'} · cadastrado em ${formatDate(client.registered_at)}`}
        icon="bi-person-badge"
        badge={<StatusBadge status={client.status} />}
      >
        <Link to="/clientes" className="btn btn-light">
          <i className="bi bi-arrow-left" /> Voltar
        </Link>
        {canWrite && (
          <Link to={`/clientes/${client.id}/editar`} className="btn btn-outline-primary">
            <i className="bi bi-pencil" /> Editar
          </Link>
        )}
        {isAdmin && (
          <button type="button" className="btn btn-outline-danger" onClick={() => setConfirmOpen(true)}>
            <i className="bi bi-trash3" /> Excluir
          </button>
        )}
      </PageHeader>

      {summary.limit_exceeded && (
        <div className="alert alert-warning fp-alert" role="alert">
          <i className="bi bi-exclamation-triangle-fill" />
          <div>
            <strong>Limite operacional excedido.</strong> A exposição em aberto de{' '}
            {formatBRL(summary.open_amount)} supera o limite informado de {formatBRL(summary.operational_limit)}.
            O sistema não bloqueia lançamentos automaticamente: a decisão é sua.
          </div>
        </div>
      )}

      <div className="stat-grid stat-grid-4">
        <SummaryTile
          label="Limite operacional"
          value={formatBRL(summary.operational_limit)}
          icon="bi-sliders"
          tone="petroleum"
          hint="Informado no cadastro"
        />
        <SummaryTile
          label="Exposição em aberto"
          value={formatBRL(summary.open_amount)}
          icon="bi-hourglass-split"
          tone="warning"
          hint={`${summary.open_documents || 0} documento(s) pendente(s)`}
        />
        <SummaryTile
          label="Limite disponível"
          value={formatBRL(summary.available_limit)}
          icon="bi-wallet2"
          tone={summary.available_limit < 0 ? 'danger' : 'green'}
          hint={percent === null || percent === undefined ? 'Sem limite definido' : `${Number(percent).toFixed(1)}% utilizado`}
        />
        <SummaryTile
          label="Valor vencido"
          value={formatBRL(summary.overdue_amount)}
          icon="bi-exclamation-triangle"
          tone="danger"
          hint={`${summary.overdue_documents || 0} documento(s) vencido(s)`}
        />
      </div>

      <div className="limit-overview">
        <div className="limit-overview-head">
          <span>Uso do limite operacional</span>
          <strong>
            {percent === null || percent === undefined ? '—' : `${Number(percent).toFixed(1)}%`}
          </strong>
        </div>
        <div className="fp-progress lg">
          <span
            className={summary.limit_exceeded ? 'danger' : percent > 80 ? 'warning' : ''}
            style={{ width: `${Math.min(Number(percent) || 0, 100)}%` }}
          />
        </div>
        <div className="limit-overview-foot">
          <span>Em aberto: {formatBRL(summary.open_amount)}</span>
          <span>Disponível: {formatBRL(summary.available_limit)}</span>
        </div>
      </div>

      {canWrite && (
        <div className="quick-actions">
          <Link to={`/cheques/novo?cliente=${client.id}`} className="quick-action">
            <span><i className="bi bi-journal-plus" /></span>
            <div>
              <strong>Novo cheque</strong>
              <small>Vincular um cheque a este cliente</small>
            </div>
            <i className="bi bi-arrow-right" />
          </Link>
          <Link to={`/boletos/novo?cliente=${client.id}`} className="quick-action">
            <span><i className="bi bi-receipt" /></span>
            <div>
              <strong>Novo boleto</strong>
              <small>Vincular um boleto a este cliente</small>
            </div>
            <i className="bi bi-arrow-right" />
          </Link>
          <Link to={`/clientes/${client.id}/editar`} className="quick-action">
            <span><i className="bi bi-person-gear" /></span>
            <div>
              <strong>Atualizar cadastro</strong>
              <small>Contato, endereço, limite e status</small>
            </div>
            <i className="bi bi-arrow-right" />
          </Link>
        </div>
      )}

      <div className="detail-layout">
        <Panel title="Dados do cliente" icon="bi-card-list" className="detail-main">
          <dl className="detail-grid">
            <div>
              <dt>CPF / CNPJ</dt>
              <dd>{formatDocument(client.document)}</dd>
            </div>
            <div>
              <dt>Tipo</dt>
              <dd>{client.person_type === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'}</dd>
            </div>
            <div>
              <dt>Telefone</dt>
              <dd>{client.phone ? formatPhone(client.phone) : '—'}</dd>
            </div>
            <div>
              <dt>WhatsApp</dt>
              <dd>
                {client.whatsapp ? (
                  wa ? (
                    <a href={wa} target="_blank" rel="noreferrer" className="inline-link">
                      <i className="bi bi-whatsapp" /> {formatPhone(client.whatsapp)}
                    </a>
                  ) : (
                    formatPhone(client.whatsapp)
                  )
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>E-mail</dt>
              <dd>
                {client.email ? (
                  <a href={`mailto:${client.email}`} className="inline-link">{client.email}</a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>CEP</dt>
              <dd>{client.zip_code ? client.zip_code.replace(/^(\d{5})(\d{3})$/, '$1-$2') : '—'}</dd>
            </div>
            <div className="span-2">
              <dt>Endereço</dt>
              <dd>{client.address || '—'}</dd>
            </div>
            <div>
              <dt>Cidade / UF</dt>
              <dd>{[client.city, client.state].filter(Boolean).join(' / ') || '—'}</dd>
            </div>
            <div>
              <dt>Cadastrado em</dt>
              <dd>{formatDate(client.registered_at)}</dd>
            </div>
            <div>
              <dt>Criado por</dt>
              <dd>{client.created_by || '—'}</dd>
            </div>
            <div>
              <dt>Última atualização</dt>
              <dd>
                {formatDateTime(client.updated_at)}
                {client.updated_by ? ` · ${client.updated_by}` : ''}
              </dd>
            </div>
          </dl>
          {client.notes && (
            <div className="notes-box">
              <span><i className="bi bi-journal-text" /> Observações internas</span>
              <p>{client.notes}</p>
            </div>
          )}
        </Panel>

        <aside className="detail-side">
          <Panel title="Totais da carteira" icon="bi-calculator">
            <dl className="side-summary">
              <div>
                <dt>Documentos</dt>
                <dd>{history?.totals?.count ?? allDocuments.length}</dd>
              </div>
              <div>
                <dt>Valor nominal</dt>
                <dd>{formatBRL(history?.totals?.nominal || 0)}</dd>
              </div>
              <div>
                <dt>Valor líquido</dt>
                <dd>{formatBRL(history?.totals?.net || 0)}</dd>
              </div>
              <div>
                <dt>Em aberto</dt>
                <dd>{formatBRL(history?.totals?.open || 0)}</dd>
              </div>
              <div>
                <dt>Liquidado</dt>
                <dd>{formatBRL(history?.totals?.settled || 0)}</dd>
              </div>
            </dl>
          </Panel>
          <div className="info-note">
            <i className="bi bi-info-circle" />
            <div>
              <strong>Sobre o limite disponível</strong>
              <p>
                O disponível é o limite operacional menos a exposição em aberto (documentos com status em
                aberto ou devolvido). É um valor derivado para alerta, não um cálculo financeiro.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <div className="fp-panel">
        <div className="fp-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              type="button"
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              className={`fp-tab ${tab === item.key ? 'active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              <i className={`bi ${item.icon}`} />
              {item.label}
              {item.key === 'abertos' && <span className="tab-count">{openDocuments.length}</span>}
              {item.key === 'documentos' && <span className="tab-count">{allDocuments.length}</span>}
            </button>
          ))}
        </div>

        {tab === 'abertos' && (
          <div className="tab-body">
            {openDocuments.length ? (
              <DocumentsTable
                items={openDocuments}
                mixed
                emptyTitle="Nenhum documento em aberto"
              />
            ) : (
              <EmptyState
                icon="bi-check2-circle"
                title="Nenhum documento em aberto"
                message="Este cliente não possui cheques ou boletos pendentes."
              >
                {canWrite && (
                  <Link to={`/cheques/novo?cliente=${client.id}`} className="btn btn-primary">
                    <i className="bi bi-plus-lg" /> Novo cheque
                  </Link>
                )}
              </EmptyState>
            )}
          </div>
        )}

        {tab === 'documentos' && (
          <div className="tab-body">
            <DocumentsTable
              items={allDocuments}
              mixed
              emptyTitle="Nenhum documento cadastrado"
              emptyMessage="Cheques e boletos vinculados a este cliente aparecerão aqui."
            />
          </div>
        )}

        {tab === 'historico' && (
          <div className="tab-body">
            {timeline.length ? (
              <ol className="timeline">
                {timeline.map((entry, index) => {
                  const meta = entry.type === 'document' ? null : actionMeta(entry.status)
                  return (
                    <li key={`${entry.date}-${index}`} className="timeline-item">
                      <span className={`timeline-dot ${entry.type}`}>
                        <i className={`bi ${entry.type === 'document' ? 'bi-file-earmark-text' : 'bi-shield-check'}`} />
                      </span>
                      <div className="timeline-content">
                        <div className="timeline-head">
                          <strong>{entry.title}</strong>
                          {meta ? (
                            <span className={`fp-badge fp-badge-${meta.variant} fp-badge-sm`}>{meta.label}</span>
                          ) : (
                            entry.status && <StatusBadge status={entry.status} size="sm" />
                          )}
                          <span className="timeline-date">{formatDateTime(entry.date)}</span>
                        </div>
                        <p>{entry.description}</p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <EmptyState
                icon="bi-clock-history"
                title="Sem eventos no histórico"
                message="Criações, alterações e mudanças de status aparecerão aqui."
              />
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Excluir cliente?"
        message={`O cliente ${client.code} - ${client.name} será excluído logicamente. O histórico é preservado e o CPF/CNPJ fica liberado para um novo cadastro. A exclusão é bloqueada se houver documentos em aberto.`}
        confirmLabel="Excluir cliente"
        loading={deleting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={remove}
      />
    </div>
  )
}
