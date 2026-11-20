import { Link } from 'react-router-dom'
import { LogoMark } from '../Logo'
import { useBrand } from '../../context/BrandContext'
import { useTheme } from '../../context/ThemeContext'

const HIGHLIGHTS = [
  {
    icon: 'bi-shield-check',
    title: 'Controle com rastreabilidade',
    text: 'Cada alteração fica registrada na auditoria, com usuário, data e valores.',
  },
  {
    icon: 'bi-sliders2',
    title: 'Valores sempre informados por você',
    text: 'O sistema não calcula juros, descontos ou taxas. Ele organiza e alerta divergências.',
  },
  {
    icon: 'bi-people',
    title: 'Perfis de acesso definidos',
    text: 'Administrador, operador e consultor com permissões distintas e rotas protegidas.',
  },
]

export default function AuthLayout({ children, footer }) {
  const { appName } = useBrand()
  const { isDark, toggle } = useTheme()

  return (
    <div className="auth-page">
      <button
        type="button"
        className="icon-btn auth-theme-toggle"
        onClick={toggle}
        aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      >
        <i className={`bi ${isDark ? 'bi-sun-fill' : 'bi-moon-stars-fill'}`} />
      </button>

      <aside className="auth-aside">
        <div className="auth-aside-inner">
          <Link to="/login" className="auth-brand">
            <LogoMark size={46} />
            <span>
              <strong>{appName}</strong>
              <small>Gestão Financeira Inteligente</small>
            </span>
          </Link>

          <div className="auth-pitch">
            <span className="auth-eyebrow">Factoring sob controle</span>
            <h1>Cheques, boletos e clientes em um só lugar.</h1>
            <p>
              Uma operação de factoring exige confiança nos números. O {appName} registra exatamente o que
              você informa e destaca o que precisa de atenção.
            </p>
          </div>

          <ul className="auth-highlights">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title}>
                <span className="auth-highlight-icon">
                  <i className={`bi ${item.icon}`} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="auth-aside-foot">
            <i className="bi bi-lock-fill" /> Sessão protegida com token de acesso e cookie httpOnly.
          </p>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-card-head">
            <Link to="/login" className="auth-brand auth-brand-mobile">
              <LogoMark size={40} />
              <span>
                <strong>{appName}</strong>
                <small>Gestão Financeira Inteligente</small>
              </span>
            </Link>
          </div>
          {children}
        </div>
        {footer && <div className="auth-footer">{footer}</div>}
        <p className="auth-legal">
          {appName} · v1.5 · Etapa 7 — relatório unificado e identidade visual personalizável.
        </p>
      </main>
    </div>
  )
}
