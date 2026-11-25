import { Link, useLocation } from 'react-router-dom'
import { useBrand } from '../context/BrandContext'

export default function NotFound() {
  const location = useLocation()
  const { appName } = useBrand()

  return (
    <div className="page">
      <div className="notfound">
        <span className="notfound-code" aria-hidden="true">404</span>
        <span className="notfound-icon">
          <i className="bi bi-signpost-split" />
        </span>
        <h2>Página não encontrada</h2>
        <p>
          O endereço <code>{location.pathname}</code> não existe no {appName} ou foi movido.
          Verifique o link ou volte para o dashboard.
        </p>
        <div className="notfound-actions">
          <Link to="/dashboard" className="btn btn-primary">
            <i className="bi bi-grid-1x2-fill" /> Ir para o dashboard
          </Link>
          <Link to="/clientes" className="btn btn-light">
            <i className="bi bi-people-fill" /> Ver clientes
          </Link>
          <Link to="/cheques" className="btn btn-light">
            <i className="bi bi-journal-check" /> Ver cheques
          </Link>
        </div>
      </div>
    </div>
  )
}
