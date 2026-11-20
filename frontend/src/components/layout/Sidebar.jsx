import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useBrand } from '../../context/BrandContext'
import { useTheme } from '../../context/ThemeContext'
import Logo from '../Logo'

const NAV_SECTIONS = [
  {
    label: 'Visão geral',
    items: [{ to: '/', label: 'Dashboard', icon: 'bi-grid-1x2-fill', end: true }],
  },
  {
    label: 'Cadastros',
    items: [
      { to: '/clientes', label: 'Clientes', icon: 'bi-people-fill' },
      { to: '/cheques', label: 'Cheques', icon: 'bi-journal-check' },
      { to: '/boletos', label: 'Boletos', icon: 'bi-receipt' },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { to: '/operacoes', label: 'Operações', icon: 'bi-arrow-left-right' },
      { to: '/recebimentos', label: 'Recebimentos', icon: 'bi-cash-coin' },
      { to: '/emprestimos', label: 'Empréstimos', icon: 'bi-cash-stack' },
      { to: '/emprestimos/relatorio', label: 'Rel. Empréstimos', icon: 'bi-bar-chart-line' },
      { to: '/relatorios', label: 'Relatórios', icon: 'bi-graph-up-arrow' },
    ],
  },
]

const SYSTEM_ITEMS = [
  { to: '/configuracoes', label: 'Configurações', icon: 'bi-gear-fill' },
  { to: '/administracao', label: 'Administração', icon: 'bi-shield-lock-fill', adminOnly: true },
]

export default function Sidebar({ collapsed, mobileOpen, onNavigate }) {
  const { user, isAdmin, logout } = useAuth()
  const { appName } = useBrand()
  const { isDark } = useTheme()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

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

  const renderItem = (item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
    >
      <i className={`bi ${item.icon}`} />
      <span className="side-label">{item.label}</span>
      {item.stage && <span className="side-stage">{item.stage}</span>}
    </NavLink>
  )

  return (
    <aside
      className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
      data-theme={isDark ? 'dark' : 'light'}
    >
      <div className="sidebar-brand">
        <Logo size={collapsed ? 36 : 38} showSubtitle={!collapsed} light />
      </div>

      <nav className="sidebar-nav" aria-label="Menu principal">
        {NAV_SECTIONS.map((section) => (
          <div className="side-section" key={section.label}>
            <span className="side-section-label">{section.label}</span>
            {section.items.map(renderItem)}
          </div>
        ))}
        <div className="side-section">
          <span className="side-section-label">Sistema</span>
          {SYSTEM_ITEMS.filter((item) => !item.adminOnly || isAdmin).map(renderItem)}
        </div>
      </nav>

      <div className="sidebar-footer" ref={menuRef}>
        <button
          type="button"
          className="side-user"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
        >
          <span className="side-avatar">{initials(user?.name)}</span>
          <span className="side-user-info">
            <strong>{user?.name?.split(' ').slice(0, 2).join(' ')}</strong>
            <small>{user?.role_label}</small>
          </span>
          <i className="bi bi-three-dots-vertical" />
        </button>
        {menuOpen && (
          <div className="side-user-menu">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onNavigate?.()
                navigate('/configuracoes')
              }}
            >
              <i className="bi bi-person-gear" /> Meu perfil e senha
            </button>
            <button type="button" className="danger" onClick={handleLogout}>
              <i className="bi bi-box-arrow-right" /> Sair do sistema
            </button>
          </div>
        )}
        {!collapsed && (
          <div className="sidebar-version">
            <span>{appName}</span>
            <span>v1.6 · Etapa 8</span>
          </div>
        )}
      </div>
    </aside>
  )
}

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}
