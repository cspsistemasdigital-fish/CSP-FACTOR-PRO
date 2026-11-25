import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/ui/PageHeader'
import Panel from '../components/ui/Panel'
import EmptyState from '../components/ui/EmptyState'

export default function AccessDenied({ adminOnly = false }) {
  const { user } = useAuth()

  return (
    <div className="page">
      <PageHeader
        title="Acesso restrito"
        subtitle="Seu perfil não possui permissão para abrir esta página."
        icon="bi-shield-lock-fill"
      />
      <Panel>
        <EmptyState
          icon="bi-shield-lock"
          title={adminOnly ? 'Somente administradores' : 'Perfil somente leitura'}
          message={
            adminOnly
              ? 'A administração de usuários, auditoria e dados da empresa é exclusiva do perfil Administrador. Fale com um administrador caso precise desse acesso.'
              : `O perfil ${user?.role_label || 'atual'} pode consultar os dados, mas não pode cadastrar ou alterar registros. Solicite a um administrador a mudança do seu perfil, se necessário.`
          }
        >
          <Link to="/dashboard" className="btn btn-primary">
            <i className="bi bi-grid-1x2-fill" /> Voltar ao dashboard
          </Link>
          <Link to="/configuracoes" className="btn btn-light">
            <i className="bi bi-gear-fill" /> Ver meu perfil
          </Link>
        </EmptyState>
      </Panel>
    </div>
  )
}
