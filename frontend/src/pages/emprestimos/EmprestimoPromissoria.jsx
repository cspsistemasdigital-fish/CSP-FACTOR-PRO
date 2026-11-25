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
    if (note) document.title = `Minuta de nota promissória — ${appName}`
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
        <header className="loan-print-company print-section">
          <div>
            <strong>{companyName || appName}</strong>
            <span>Documento preparado a partir dos dados informados no sistema</span>
          </div>
          <span className="promissory-draft-stamp">MINUTA</span>
        </header>

        <div className="promissory-heading">
          <span>DOCUMENTO PARA CONFERÊNCIA</span>
          <h1>NOTA PROMISSÓRIA</h1>
          <strong>MINUTA — REQUER REVISÃO JURÍDICA</strong>
        </div>

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
          <p>
            Pela presente minuta, <strong>{client.name}</strong> reconhece os dados abaixo como
            referência para a obrigação informada no cadastro do empréstimo. O documento definitivo
            deve ser conferido, completado e validado pelas partes antes de qualquer assinatura.
          </p>
          <div className="promissory-values">
            <div>
              <span>Valor emprestado informado</span>
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
          <h2>Parcelas informadas</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Vencimento</th>
                <th className="text-end">Valor informado</th>
              </tr>
            </thead>
            <tbody>
              {note.installments.map((installment) => (
                <tr key={installment.number}>
                  <td>{String(installment.number).padStart(2, '0')}</td>
                  <td>{formatDate(installment.due_date)}</td>
                  <td className="text-end">{formatBRL(installment.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <p className="promissory-disclaimer print-section">
          Este arquivo é uma minuta operacional, não constitui modelo homologado nem parecer jurídico.
          Confirme com assessoria jurídica os requisitos legais, valores, vencimentos, praça de pagamento
          e identificação completa das partes antes de utilizar ou colher assinaturas.
        </p>

        <div className="promissory-signature print-section">
          <p>Local: __________________________________________ &nbsp; Data: ____ / ____ / ________</p>
          <div className="promissory-signature-line" />
          <strong>{client.name}</strong>
          <span>Emitente / Devedor · {client.document ? formatDocument(client.document) : 'Documento: __________________'}</span>
        </div>
      </article>
    </div>
  )
}
