import { Link } from 'react-router-dom'
import { LogoMark } from '../components/Logo'
import { useAuth } from '../context/AuthContext'
import { useBrand } from '../context/BrandContext'
import { useTheme } from '../context/ThemeContext'

const FEATURES = [
  {
    icon: 'bi-bar-chart-line',
    title: 'Visão clara da operação',
    text: 'Acompanhe carteira, movimentações e indicadores em painéis organizados.',
  },
  {
    icon: 'bi-calendar2-check',
    title: 'Compromissos em dia',
    text: 'Centralize reuniões e compromissos da equipe em uma agenda compartilhada.',
  },
  {
    icon: 'bi-shield-check',
    title: 'Controle com rastreabilidade',
    text: 'Registros e alterações relevantes contam com histórico e controle de acesso.',
  },
]

export default function HomePage() {
  const { appName, logoUrl } = useBrand()
  const { user } = useAuth()
  const { isDark, toggle } = useTheme()
  const accessPath = user ? '/dashboard' : '/login'

  return (
    <div className="home-page">
      <header className="home-nav">
        <Link to="/" className="home-brand" aria-label={`${appName} - início`}>
          {logoUrl ? <img src={logoUrl} alt="" /> : <LogoMark size={40} />}
          <span>
            <strong>{appName}</strong>
            <small>GESTÃO FINANCEIRA INTELIGENTE</small>
          </span>
        </Link>
        <nav className="home-nav-links" aria-label="Navegação da página inicial">
          <a href="#solucoes">Soluções</a>
          <a href="#diferenciais">Diferenciais</a>
        </nav>
        <button
          type="button"
          className="home-theme-toggle"
          onClick={toggle}
          aria-label={`Ativar modo ${isDark ? 'claro' : 'escuro'}`}
          title={`Ativar modo ${isDark ? 'claro' : 'escuro'}`}
        >
          <i className={`bi ${isDark ? 'bi-sun-fill' : 'bi-moon-stars-fill'}`} aria-hidden="true" />
          <span>{isDark ? 'Claro' : 'Escuro'}</span>
        </button>
        <Link className="home-nav-cta" to={accessPath}>
          Acessar sistema <i className="bi bi-arrow-up-right" />
        </Link>
      </header>

      <main>
        <section className="home-hero">
          <div className="home-hero-copy">
            <span className="home-eyebrow"><i /> GESTÃO INTELIGENTE PARA FACTORING</span>
            <h1>Mais clareza para decisões que <em>movem negócios.</em></h1>
            <p>
              Organize clientes, títulos, operações e compromissos em uma experiência
              profissional, segura e feita para dar visão ao seu dia a dia.
            </p>
            <div className="home-hero-actions">
              <Link className="home-primary-cta" to={accessPath}>
                Acessar {appName} <i className="bi bi-arrow-right" />
              </Link>
              <a className="home-secondary-cta" href="#solucoes">
                Conheça a plataforma <i className="bi bi-chevron-down" />
              </a>
            </div>
            <div className="home-trust-note">
              <span><i className="bi bi-lock-fill" /></span>
              <p><strong>Acesso protegido</strong><small>Controle por perfil e sessão segura</small></p>
            </div>
          </div>

          <div className="home-hero-art" aria-label="Prévia ilustrativa do painel de gestão">
            <div className="home-orbit home-orbit-one" />
            <div className="home-orbit home-orbit-two" />
            <div className="home-dashboard-card">
              <div className="home-preview-top">
                <span className="home-preview-mark"><LogoMark size={26} /></span>
                <div><strong>Visão geral</strong><small>Seu negócio, em perspectiva</small></div>
                <span className="home-preview-dots"><i /><i /><i /></span>
              </div>
              <div className="home-preview-greeting">
                <span>PAINEL DE CONTROLE</span>
                <strong>Uma operação mais organizada.</strong>
              </div>
              <div className="home-preview-stats">
                <div><span>CLIENTES</span><strong><i className="bi bi-people" /> Gestão centralizada</strong><small>Cadastros e histórico</small></div>
                <div><span>AGENDA</span><strong><i className="bi bi-calendar-check" /> Equipe alinhada</strong><small>Compromissos compartilhados</small></div>
              </div>
              <div className="home-preview-chart">
                <div className="home-chart-copy"><span>ACOMPANHAMENTO</span><strong>Visão completa, sem ruído</strong></div>
                <div className="home-chart-bars" aria-hidden="true">
                  {[34, 52, 43, 69, 57, 82, 65, 92, 73, 100, 79, 88].map((height, index) => (
                    <i key={index} style={{ height: `${height}%` }} />
                  ))}
                </div>
                <div className="home-chart-labels"><span>Organização</span><span>Controle</span><span>Clareza</span></div>
              </div>
              <div className="home-preview-footer">
                <span><i className="bi bi-shield-check" /> Acesso por perfil</span>
                <span><i className="bi bi-check2-circle" /> Dados rastreáveis</span>
              </div>
            </div>
            <div className="home-float-card home-float-calendar">
              <span><i className="bi bi-calendar2-week" /></span>
              <div><strong>Agenda compartilhada</strong><small>Compromissos em um só lugar</small></div>
            </div>
            <div className="home-float-card home-float-secure">
              <i className="bi bi-shield-lock-fill" />
              <span>Controle e segurança</span>
            </div>
          </div>
          <div className="home-hero-bottom"><span>01 — UMA NOVA VISÃO DA GESTÃO</span><span>DESLIZE PARA EXPLORAR <i className="bi bi-arrow-down" /></span></div>
        </section>

        <section className="home-intro" id="solucoes">
          <div>
            <span className="home-section-kicker">UMA PLATAFORMA, MAIS CONTROLE</span>
            <h2>O essencial da sua operação.<br /><em>Em um só lugar.</em></h2>
          </div>
          <p>
            Da rotina financeira aos compromissos da equipe, tenha ferramentas
            conectadas para trabalhar com mais contexto e previsibilidade.
          </p>
        </section>

        <section className="home-features" id="diferenciais">
          {FEATURES.map((feature, index) => (
            <article className="home-feature-card" key={feature.title}>
              <div className="home-feature-number">0{index + 1}</div>
              <span className="home-feature-icon"><i className={`bi ${feature.icon}`} /></span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
              <i className="bi bi-arrow-up-right home-feature-arrow" />
            </article>
          ))}
        </section>

        <section className="home-closing">
          <div className="home-closing-mark"><LogoMark size={38} /></div>
          <div><span className="home-section-kicker">PRONTO PARA COMEÇAR?</span><h2>Sua gestão, com mais direção.</h2></div>
          <Link className="home-primary-cta" to={accessPath}>
            Acessar sistema <i className="bi bi-arrow-right" />
          </Link>
        </section>
      </main>

      <footer className="home-footer">
        <Link to="/" className="home-footer-brand">{appName}<span> · Gestão Financeira Inteligente</span></Link>
        <span>© {new Date().getFullYear()} {appName}. Todos os direitos reservados.</span>
      </footer>
    </div>
  )
}
