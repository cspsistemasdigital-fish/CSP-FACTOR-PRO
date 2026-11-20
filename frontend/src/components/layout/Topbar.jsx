import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useBrand } from '../../context/BrandContext'
import { useTheme } from '../../context/ThemeContext'
import { useInstallPrompt } from '../../hooks/useInstallPrompt'
import { initials } from '../../utils/format'

const TITLES = [
  { match: /^\/$/, title: 'Dashboard financeiro' },
  { match: /^\/clientes\/novo/, title: 'Novo cliente' },
  { match: /^\/clientes\/\d+\/editar/, title: 'Editar cliente' },
  { match: /^\/clientes\/\d+/, title: 'Detalhes do cliente' },
  { match: /^\/clientes/, title: 'Clientes' },
  { match: /^\/cheques\/novo/, title: 'Novo cheque' },
  { match: /^\/cheques\/\d+\/editar/, title: 'Editar cheque' },
  { match: /^\/cheques\/\d+/, title: 'Detalhes do cheque' },
  { match: /^\/cheques/, title: 'Cheques' },
  { match: /^\/boletos\/novo/, title: 'Novo boleto' },
  { match: /^\/boletos\/\d+\/editar/, title: 'Editar boleto' },
  { match: /^\/boletos\/\d+/, title: 'Detalhes do boleto' },
  { match: /^\/boletos/, title: 'Boletos' },
  { match: /^\/operacoes/, title: 'Operações' },
  { match: /^\/recebimentos/, title: 'Recebimentos' },
  { match: /^\/emprestimos\/relatorio/, title: 'Relatório de Empréstimos' },
  { match: /^\/emprestimos\/novo/, title: 'Novo empréstimo' },
  { match: /^\/emprestimos\/\d+\/editar/, title: 'Editar empréstimo' },
  { match: /^\/emprestimos\/\d+\/duplicata/, title: 'Duplicata' },
  { match: /^\/emprestimos\/\d+/, title: 'Detalhes do empréstimo' },
  { match: /^\/emprestimos/, title: 'Empréstimos' },
  { match: /^\/relatorios/, title: 'Relatórios' },
  { match: /^\/configuracoes/, title: 'Configurações' },
  { match: /^\/administracao/, title: 'Administração' },
]

function pageTitle(pathname, fallback) {
  return TITLES.find((entry) => entry.match.test(pathname))?.title || fallback
}

export default function Topbar({ onToggleSidebar, onOpenMobile }) {
  const { user, logout, isAdmin } = useAuth()
  const { appName } = useBrand()
  const { isDark, toggle } = useTheme()
  const { canInstall, install } = useInstallPrompt()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => setMenuOpen(false), [location.pathname])

  useEffect(() => {
    const onClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const handleInstall = async () => {
    await install()
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="icon-btn d-lg-none"
          onClick={onOpenMobile}
          aria-label="Abrir menu"
        >
          <i className="bi bi-list" />
        </button>
        <button
          type="button"
          className="icon-btn d-none d-lg-inline-flex"
          onClick={onToggleSidebar}
          aria-label="Recolher menu"
        >
          <i className="bi bi-layout-sidebar-inset" />
        </button>
        <div className="topbar-title">
          <span className="topbar-eyebrow">{appName}</span>
          <h1>{pageTitle(location.pathname, appName)}</h1>
        </div>
      </div>

      <div className="topbar-right">
        {canInstall && (
          <button type="button" className="btn btn-sm btn-install d-none d-sm-inline-flex" onClick={handleInstall}>
            <i className="bi bi-download" /> Instalar app
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={toggle}
          aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
          title={isDark ? 'Tema claro' : 'Tema escuro'}
        >
          <i className={`bi ${isDark ? 'bi-sun-fill' : 'bi-moon-stars-fill'}`} />
        </button>

        <div className="topbar-user" ref={menuRef}>
          <button
            type="button"
            className="user-trigger"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
          >
            <span className="user-avatar">{initials(user?.name)}</span>
            <span className="user-text d-none d-md-flex">
              <strong>{user?.name}</strong>
              <small>{user?.role_label}</small>
            </span>
            <i className="bi bi-chevron-down d-none d-md-inline" />
          </button>
          {menuOpen && (
            <div className="user-menu">
              <div className="user-menu-head">
                <span className="user-avatar lg">{initials(user?.name)}</span>
                <div>
                  <strong>{user?.name}</strong>
                  <small>{user?.email}</small>
                  <span className="role-chip">{user?.role_label}</span>
                </div>
              </div>
              <Link to="/configuracoes" className="user-menu-item">
                <i className="bi bi-person-gear" /> Meu perfil
              </Link>
              <Link to="/configuracoes" className="user-menu-item">
                <i className="bi bi-palette" /> Aparência
              </Link>
              {isAdmin && (
                <Link to="/administracao" className="user-menu-item">
                  <i className="bi bi-shield-lock" /> Administração
                </Link>
              )}
              {canInstall && (
                <button type="button" className="user-menu-item" onClick={handleInstall}>
                  <i className="bi bi-download" /> Instalar aplicativo
                </button>
              )}
              <button type="button" className="user-menu-item danger" onClick={handleLogout}>
                <i className="bi bi-box-arrow-right" /> Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
