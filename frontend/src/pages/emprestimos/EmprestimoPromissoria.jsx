import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useBrand } from '../../context/BrandContext'
import EmptyState from '../../components/ui/EmptyState'
import { formatBRL, formatDate, formatDocument } from '../../utils/format'

export default function EmprestimoPromissoria() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const { appName, companyName } = useBrand()
  const note = state?.promissory
  const client = note?.client || {}

  useEffect(() => {
    if (note) document.title = `Nota Promissória — ${appName}`
    return () => {
      document.title = `${appName} | Gestão Financeira Inteligente`
    }
  }, [note, appName])

  if (!note) {
    return (
      <div className="loan-print-page">
        <div className="print-toolbar no-print">
          <button type="button" className="btn btn-light" onClick={() => navigate('/emprestimos/novo')}>
            <i className="bi bi-arrow-left" /> Voltar ao empréstimo
          </button>
        </div>
        <div className="fp-panel">
          <EmptyState
            icon="bi-file-earmark-text"
            title="Dados da minuta indisponíveis"
            message="Volte ao formulário do empréstimo e gere a minuta após preencher os dados."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="loan-print-page">
      <div className="print-toolbar no-print">
        <button
          type="button"
          className="btn btn-light"
          onClick={() => navigate('/emprestimos/novo', { state: { loanDraft: state?.loanDraft } })}
        >
          <i className="bi bi-arrow-left" /> Voltar ao formulário
        </button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          <i className="bi bi-printer" /> Imprimir / salvar PDF
        </button>
      </div>

      <article className="print-sheet loan-print-sheet promissory-sheet">
        <h1 className="promissory-title print-section">NOTA PROMISSÓRIA</h1>

        <div className="promissory-parties print-section">
          <div>
            <span>EMITENTE / DEVEDOR</span>
            <strong>{client.name}</strong>
            <small>{client.document ? formatDocument(client.document) : 'Documento não informado'}</small>
            <small>{[client.address, client.city, client.state].filter(Boolean).join(' · ') || 'Endereço não informado'}</small>
          </div>
          <div>
            <span>FAVORECIDO</span>
            <strong>{companyName || appName}</strong>
          </div>
        </div>

        <section className="promissory-promise print-section">
          <div className="promissory-values">
            <div>
              <span>Valor do empréstimo</span>
              <strong>{formatBRL(note.loanAmount)}</strong>
            </div>
            <div>
              <span>Quantidade de parcelas</span>
              <strong>{note.installments.length}</strong>
            </div>
            <div>
              <span>Data do empréstimo</span>
              <strong>{formatDate(note.loanDate)}</strong>
            </div>
          </div>
        </section>

        <section className="promissory-installments print-section">
          <h2>Parcelas</h2>
          <div className="promissory-installment-grid">
            {note.installments.map((installment) => (
              <div className="promissory-installment" key={installment.number}>
                <span className="promissory-installment-number">
                  {String(installment.number).padStart(2, '0')}
                </span>
                <time dateTime={installment.due_date}>{formatDate(installment.due_date)}</time>
                <strong>{formatBRL(installment.amount)}</strong>
              </div>
            ))}
          </div>
        </section>

        <div className="promissory-signature print-section">
          <p>Local: _________________________________ &nbsp; Data: ____ / ____ / ________</p>
          <div className="promissory-signature-line" />
          <strong>{client.name}</strong>
          <span>Emitente / Devedor · {client.document ? formatDocument(client.document) : 'Documento: __________________'}</span>
        </div>
      </article>
    </div>
  )
}
