import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { loansApi } from '../../api'
import { apiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import Logo from '../../components/Logo'
import { ErrorBlock, LoadingBlock } from '../../components/ui/Feedback'
import {
  formatBRL,
  formatDate,
  formatDateTime,
  formatDocument,
  formatPhone,
} from '../../utils/format'

const ROWS_PER_PAGE = 14

function CompanyBlock({ company }) {
  const cityLine = [company.company_city, company.company_state].filter(Boolean).join(' / ')
  return (
    <header className="loan-print-company print-section">
      <Logo size={46} showSubtitle={false} />
      <div>
        <strong>{company.company_name || 'FACTOR PRO'}</strong>
        {company.company_document && <span>CNPJ/CPF: {formatDocument(company.company_document)}</span>}
        {company.company_address && <span>{company.company_address}</span>}
        {cityLine && <span>{cityLine}</span>}
        <span>
          {[company.company_phone && formatPhone(company.company_phone), company.company_email]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
    </header>
  )
}

export default function EmprestimoPrint() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: response } = await loansApi.duplicata(id)
      setData(response)
    } catch (requestError) {
      setError(apiError(requestError).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!loading && !error && data) {
      document.title = `Duplicata ${data.item.code} — FACTOR PRO`
    }
    return () => {
      document.title = 'FACTOR PRO'
    }
  }, [loading, error, data])

  if (loading) {
    return (
      <div className="loan-print-page">
        <LoadingBlock label="Preparando a duplicata…" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="loan-print-page">
        <ErrorBlock message={error || 'Duplicata não encontrada.'} onRetry={load} />
      </div>
    )
  }

  const { item, company, generated_at: generatedAt } = data
  const client = item.client || {}
  const installments = item.installments || []
  const chunks = []
  for (let index = 0; index < installments.length; index += ROWS_PER_PAGE) {
    chunks.push(installments.slice(index, index + ROWS_PER_PAGE))
  }
  if (!chunks.length) chunks.push([])

  const clientAddress = [client.address, client.city, client.state, client.zip_code]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="loan-print-page">
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-light" onClick={() => navigate(-1)}>
          <i className="bi bi-arrow-left" /> Voltar
        </button>
        <div className="print-toolbar-actions">
          <Link to={`/emprestimos/${item.id}`} className="btn btn-outline-secondary">
            <i className="bi bi-cash-coin" /> Ver empréstimo
          </Link>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            <i className="bi bi-printer" /> Imprimir / salvar PDF
          </button>
        </div>
      </div>

      <article className="print-sheet loan-print-sheet" aria-label={`Duplicata ${item.code}`}>
        {chunks.map((chunk, pageIndex) => (
          <section className="print-page loan-print-page-sheet" key={pageIndex}>
            <CompanyBlock company={company} />

            <div className="loan-print-title print-section">
              <div>
                <span>DOCUMENTO DE EMPRÉSTIMO</span>
                <h1>Duplicata</h1>
              </div>
              <div className="loan-print-number">
                <span>Número</span>
                <strong>{item.code}</strong>
                <small>{formatDate(item.loan_date)}</small>
              </div>
            </div>

            {pageIndex === 0 && (
              <>
                <div className="loan-print-parties print-section">
                  <div>
                    <h2>Contratante / Empresa</h2>
                    <strong>{company.company_name || 'FACTOR PRO'}</strong>
                    {company.company_document && <span>CNPJ/CPF: {formatDocument(company.company_document)}</span>}
                    {company.company_address && <span>{company.company_address}</span>}
                    {[company.company_city, company.company_state].filter(Boolean).length > 0 && (
                      <span>{[company.company_city, company.company_state].filter(Boolean).join(' / ')}</span>
                    )}
                  </div>
                  <div>
                    <h2>Cliente / Devedor</h2>
                    <strong>{client.name || '—'}</strong>
                    <span>
                      {client.code ? `${client.code} · ` : ''}
                      {client.document ? formatDocument(client.document) : '—'}
                    </span>
                    <span>{clientAddress || 'Endereço não informado'}</span>
                    <span>{formatPhone(client.whatsapp || client.phone)}</span>
                    {client.email && <span>{client.email}</span>}
                  </div>
                </div>

                <div className="loan-print-metrics print-metrics print-section">
                  <div className="print-metric">
                    <span>Valor do empréstimo</span>
                    <strong>{formatBRL(item.loan_amount)}</strong>
                  </div>
                  <div className="print-metric">
                    <span>Recebido pelo cliente</span>
                    <strong>{formatBRL(item.received_amount)}</strong>
                  </div>
                  <div className="print-metric">
                    <span>Lucro informado</span>
                    <strong>{formatBRL(item.profit_amount)}</strong>
                  </div>
                  <div className="print-metric">
                    <span>Situação</span>
                    <strong>{item.status_label || item.status}</strong>
                  </div>
                </div>
              </>
            )}

            <div className="loan-print-schedule print-section">
              <h2>
                Parcelas e vencimentos
                {chunks.length > 1 ? ` — página ${pageIndex + 1}/${chunks.length}` : ''}
              </h2>
              <table className="print-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>Nº</th>
                    <th style={{ width: 120 }}>Vencimento</th>
                    <th className="text-end" style={{ width: 130 }}>
                      Valor
                    </th>
                    <th>Situação</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {chunk.map((entry) => (
                    <tr key={entry.id}>
                      <td>{String(entry.number).padStart(2, '0')}</td>
                      <td>{formatDate(entry.due_date)}</td>
                      <td className="text-end">{formatBRL(entry.amount)}</td>
                      <td>{entry.status_label || entry.status}</td>
                      <td>{entry.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                {pageIndex === chunks.length - 1 && (
                  <tfoot>
                    <tr>
                      <th colSpan={2}>Total das parcelas</th>
                      <th className="text-end">{formatBRL(item.totals?.scheduled)}</th>
                      <th colSpan={2}>Em aberto: {formatBRL(item.totals?.open_amount)}</th>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {pageIndex === chunks.length - 1 && (
              <>
                <div className="loan-print-notes print-section">
                  <h2>Observações</h2>
                  <p>{item.notes || 'Nenhuma observação informada.'}</p>
                </div>

                <p className="loan-print-statement print-section">
                  Os valores acima são exatamente os informados no sistema. O FACTOR PRO não calcula juros,
                  descontos, taxas ou encargos automaticamente; as parcelas são vencimentos organizados a partir
                  do valor informado. Este documento é gerado para conferência e impressão, sem criar novo
                  registro.
                </p>

                <div className="print-sign loan-print-sign print-section">
                  <div>
                    <span>Assinatura do cliente</span>
                    <small>{client.name || '—'}</small>
                  </div>
                  <div>
                    <span>Assinatura da empresa</span>
                    <small>{company.company_name || 'FACTOR PRO'}</small>
                  </div>
                </div>

                {company.company_signature && <p className="loan-print-footer-note">{company.company_signature}</p>}

                <footer className="loan-print-foot">
                  <span>
                    Emitido em {formatDateTime(generatedAt)}
                    {user?.name ? ` por ${user.name}` : ''}
                  </span>
                  <span>{item.code}</span>
                </footer>
              </>
            )}
          </section>
        ))}
      </article>
    </div>
  )
}
