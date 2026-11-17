import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { receiptsApi } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import Logo from '../../components/Logo'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import { formatBRL, formatDate, formatDateTime, formatDocument, formatPhone } from '../../utils/format'

function CompanyBlock({ company }) {
  const cityLine = [company.company_city, company.company_state].filter(Boolean).join(' / ')
  return (
    <header className="recibo-company">
      <Logo size={44} showSubtitle={false} />
      <div className="recibo-company-info">
        <strong>{company.company_name || 'FACTOR PRO'}</strong>
        {company.company_document && <span>CNPJ/CPF: {formatDocument(company.company_document)}</span>}
        {company.company_address && <span>{company.company_address}</span>}
        {cityLine && <span>{cityLine}</span>}
        <span>
          {company.company_phone ? formatPhone(company.company_phone) : ''}
          {company.company_phone && company.company_email ? ' · ' : ''}
          {company.company_email || ''}
        </span>
      </div>
    </header>
  )
}

export default function ReciboPrint() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [recibo, setRecibo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await receiptsApi.recibo(id)
      setRecibo(data.item)
    } catch (requestError) {
      setError(apiError(requestError).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="recibo-page">
        <LoadingBlock label="Preparando o recibo…" />
      </div>
    )
  }

  if (error || !recibo) {
    return (
      <div className="recibo-page">
        <ErrorBlock message={error || 'Recibo não encontrado.'} onRetry={load} />
      </div>
    )
  }

  const { company, client, document, receipt } = recibo

  return (
    <div className="recibo-page">
      <div className="recibo-toolbar no-print">
        <button type="button" className="btn btn-light" onClick={() => navigate(-1)}>
          <i className="bi bi-arrow-left" /> Voltar
        </button>
        <div className="recibo-toolbar-actions">
          <Link to={`/recebimentos/${receipt.id}`} className="btn btn-outline-secondary">
            <i className="bi bi-cash-coin" /> Ver recebimento
          </Link>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            <i className="bi bi-printer" /> Imprimir
          </button>
        </div>
      </div>

      <article className="recibo-sheet" aria-label={`Recibo ${recibo.number}`}>
        <CompanyBlock company={company} />

        <div className="recibo-title">
          <h1>Recibo de recebimento</h1>
          <div className="recibo-number">
            <span>Nº</span>
            <strong>{recibo.number}</strong>
          </div>
        </div>

        <p className="recibo-lead">
          Recebemos de <strong>{client?.name || 'cliente'}</strong>
          {client?.document ? ` (${formatDocument(client.document)})` : ''} o valor abaixo, referente à baixa do
          título discriminado.
        </p>

        <div className="recibo-amount">
          <span>Valor recebido</span>
          <strong>{formatBRL(recibo.amount)}</strong>
        </div>

        <dl className="recibo-grid">
          <div>
            <dt>Data do recebimento</dt>
            <dd>{formatDate(receipt.receipt_date)}</dd>
          </div>
          <div>
            <dt>Cliente</dt>
            <dd>
              {client?.code ? `${client.code} · ` : ''}
              {client?.name || '—'}
            </dd>
          </div>
          <div>
            <dt>Documento do cliente</dt>
            <dd>{client?.document ? formatDocument(client.document) : '—'}</dd>
          </div>
          <div>
            <dt>Endereço</dt>
            <dd>
              {[client?.address, client?.city, client?.state].filter(Boolean).join(', ') || '—'}
            </dd>
          </div>
          <div>
            <dt>Título</dt>
            <dd>
              {receipt.document_label} {document?.code || `#${receipt.document_id}`}
            </dd>
          </div>
          <div>
            <dt>Vencimento do título</dt>
            <dd>{formatDate(document?.due_date)}</dd>
          </div>
          <div>
            <dt>Valor líquido do título</dt>
            <dd>{formatBRL(recibo.document_net)}</dd>
          </div>
          <div>
            <dt>Total recebido do título</dt>
            <dd>{formatBRL(recibo.received_total)}</dd>
          </div>
          <div>
            <dt>Saldo em aberto</dt>
            <dd>{formatBRL(recibo.remaining_amount)}</dd>
          </div>
          <div>
            <dt>Situação do título</dt>
            <dd>{document?.status_label || '—'}</dd>
          </div>
        </dl>

        {receipt.notes && (
          <div className="recibo-notes">
            <span>Observações</span>
            <p>{receipt.notes}</p>
          </div>
        )}

        <p className="recibo-statement">
          Este recibo registra um recebimento informado manualmente. O FACTOR PRO não calcula juros, descontos
          ou encargos: os valores acima são exatamente os informados na baixa.
        </p>

        <div className="recibo-signature">
          <div className="recibo-signature-line" />
          <strong>{company.company_name || 'FACTOR PRO'}</strong>
          {company.company_document && <span>{formatDocument(company.company_document)}</span>}
        </div>

        {company.company_signature && <p className="recibo-footer-note">{company.company_signature}</p>}

        <footer className="recibo-foot">
          <span>Emitido em {formatDateTime(recibo.issued_at)}</span>
          <span>
            {user?.name ? `por ${user.name}` : ''}
          </span>
        </footer>
      </article>
    </div>
  )
}
