import { Link } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import Panel from '../components/ui/Panel'

/**
 * Honest placeholder for modules scheduled to later stages.
 * It never renders fictional data: only the planned scope and what the
 * current stage already delivers.
 */
export default function PendingModule({
  title,
  stage,
  icon,
  summary,
  planned = [],
  dependencies = [],
  related = [],
}) {
  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={`Módulo planejado para a ${stage}. Nenhum dado fictício é exibido nesta tela.`}
        icon={icon}
        badge={<span className="fp-badge fp-badge-petroleum">Planejado · {stage}</span>}
      >
        <Link to="/" className="btn btn-light">
          <i className="bi bi-arrow-left" /> Voltar ao dashboard
        </Link>
      </PageHeader>

      <section className="pending-hero">
        <span className="pending-hero-icon">
          <i className={`bi ${icon}`} />
        </span>
        <div>
          <span className="pending-eyebrow">{stage} · em desenvolvimento</span>
          <h2>{title} ainda não faz parte do escopo entregue</h2>
          <p>{summary}</p>
        </div>
      </section>

      <div className="pending-grid">
        <Panel title="O que será entregue" subtitle={`Escopo previsto para a ${stage}.`} icon="bi-list-check">
          <ul className="pending-list">
            {planned.map((item) => (
              <li key={item}>
                <i className="bi bi-check2-circle" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="O que já está disponível" subtitle="Tudo com dados reais e auditáveis." icon="bi-check-circle">
          <ul className="pending-list available">
            <li>
              <i className="bi bi-people-fill" />
              <span><strong>Clientes</strong> — cadastro, limite operacional e histórico.</span>
            </li>
            <li>
              <i className="bi bi-journal-check" />
              <span><strong>Cheques</strong> — valores informados, vencimentos e anexos.</span>
            </li>
            <li>
              <i className="bi bi-receipt" />
              <span><strong>Boletos</strong> — valores originais, linha digitável e anexos.</span>
            </li>
            <li>
              <i className="bi bi-grid-1x2-fill" />
              <span><strong>Dashboard</strong> — consolidado dos lançamentos do período.</span>
            </li>
            <li>
              <i className="bi bi-shield-lock-fill" />
              <span><strong>Auditoria</strong> — registro de cada alteração realizada.</span>
            </li>
          </ul>
        </Panel>
      </div>

      {dependencies.length > 0 && (
        <div className="info-note">
          <i className="bi bi-signpost-split" />
          <div>
            <strong>Dependências e ordem de entrega</strong>
            {dependencies.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </div>
      )}

      {related.length > 0 && (
        <Panel title="Continuar trabalhando no sistema" icon="bi-arrow-right-circle">
          <div className="pending-links">
            {related.map((link) => (
              <Link key={link.to} to={link.to} className="quick-action">
                <span><i className={`bi ${link.icon}`} /></span>
                <div>
                  <strong>{link.label}</strong>
                  <small>{link.hint}</small>
                </div>
                <i className="bi bi-arrow-right" />
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
