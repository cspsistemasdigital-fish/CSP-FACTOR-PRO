import { lazy, Suspense } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { useBrand } from './context/BrandContext'
import { LogoMark } from './components/Logo'
import AppLayout from './components/layout/AppLayout'

// Pages are loaded on demand so the initial bundle stays small (Etapa 5).
// Layout, guards and the boot screen remain eager: they are needed before any
// page can render.
const Login = lazy(() => import('./pages/auth/Login'))
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'))
const ForcePasswordChange = lazy(() => import('./pages/auth/ForcePasswordChange'))
const HomePage = lazy(() => import('./pages/HomePage'))

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Agenda = lazy(() => import('./pages/Agenda'))
const ClientsList = lazy(() => import('./pages/clients/ClientsList'))
const ClientForm = lazy(() => import('./pages/clients/ClientForm'))
const ClientDetail = lazy(() => import('./pages/clients/ClientDetail'))
const ChequesList = lazy(() => import('./pages/cheques/ChequesList'))
const ChequeForm = lazy(() => import('./pages/cheques/ChequeForm'))
const ChequeDetail = lazy(() => import('./pages/cheques/ChequeDetail'))
const BoletosList = lazy(() => import('./pages/boletos/BoletosList'))
const BoletoForm = lazy(() => import('./pages/boletos/BoletoForm'))
const BoletoDetail = lazy(() => import('./pages/boletos/BoletoDetail'))
const OperacoesList = lazy(() => import('./pages/operacoes/OperacoesList'))
const OperacaoForm = lazy(() => import('./pages/operacoes/OperacaoForm'))
const OperacaoDetail = lazy(() => import('./pages/operacoes/OperacaoDetail'))
const RecebimentosList = lazy(() => import('./pages/recebimentos/RecebimentosList'))
const RecebimentoForm = lazy(() => import('./pages/recebimentos/RecebimentoForm'))
const RecebimentoDetail = lazy(() => import('./pages/recebimentos/RecebimentoDetail'))
const EmprestimosList = lazy(() => import('./pages/emprestimos/EmprestimosList'))
const EmprestimoForm = lazy(() => import('./pages/emprestimos/EmprestimoForm'))
const EmprestimoDetail = lazy(() => import('./pages/emprestimos/EmprestimoDetail'))
const RelatorioEmprestimos = lazy(() => import('./pages/emprestimos/RelatorioEmprestimos'))
const EmprestimoPrint = lazy(() => import('./pages/emprestimos/EmprestimoPrint'))
const EmprestimoPromissoria = lazy(() => import('./pages/emprestimos/EmprestimoPromissoria'))
const ReciboPrint = lazy(() => import('./pages/recibos/ReciboPrint'))
const Relatorios = lazy(() => import('./pages/relatorios/Relatorios'))
const Settings = lazy(() => import('./pages/Settings'))
const Admin = lazy(() => import('./pages/Admin'))
const AccessDenied = lazy(() => import('./pages/AccessDenied'))
const NotFound = lazy(() => import('./pages/NotFound'))

function BootScreen({ label = 'Verificando sessão segura…' }) {
  const { appName } = useBrand()
  return (
    <div className="app-boot" role="status" aria-live="polite">
      <LogoMark size={58} />
      <strong>{appName}</strong>
      <span>{label}</span>
      <span className="spinner-border spinner-border-sm" aria-hidden="true" />
    </div>
  )
}

function RequireAuth() {
  const { user, booting } = useAuth()
  const location = useLocation()

  if (booting) return <BootScreen />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (user.must_change_password) return <Navigate to="/trocar-senha" replace />
  return <Outlet />
}

function RequireGuest() {
  const { user, booting } = useAuth()
  if (booting) return <BootScreen />
  if (user) return <Navigate to={user.must_change_password ? '/trocar-senha' : '/dashboard'} replace />
  return <Outlet />
}

function RequirePasswordChange() {
  const { user, booting } = useAuth()
  if (booting) return <BootScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!user.must_change_password) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

function WriteOnly() {
  const { canWrite } = useAuth()
  if (!canWrite) return <AccessDenied />
  return <Outlet />
}

function AdminOnly() {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <AccessDenied adminOnly />
  return <Outlet />
}

export default function App() {
  return (
    <Suspense fallback={<BootScreen label="Carregando tela…" />}>
      <Routes>
        <Route path="/" element={<HomePage />} />

        <Route element={<RequireGuest />}>
          <Route path="/login" element={<Login />} />
          <Route path="/esqueci-senha" element={<ForgotPassword />} />
          <Route path="/redefinir-senha" element={<ResetPassword />} />
        </Route>

        <Route element={<RequirePasswordChange />}>
          <Route path="/trocar-senha" element={<ForcePasswordChange />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="agenda" element={<Agenda />} />

            <Route path="clientes" element={<ClientsList />} />
            <Route path="clientes/:id" element={<ClientDetail />} />

            <Route path="cheques" element={<ChequesList />} />
            <Route path="cheques/:id" element={<ChequeDetail />} />

            <Route path="boletos" element={<BoletosList />} />
            <Route path="boletos/:id" element={<BoletoDetail />} />

            <Route path="operacoes" element={<OperacoesList />} />
            <Route path="operacoes/:id" element={<OperacaoDetail />} />

            <Route path="recebimentos" element={<RecebimentosList />} />
            <Route path="recebimentos/:id" element={<RecebimentoDetail />} />

            <Route path="emprestimos" element={<EmprestimosList />} />
            <Route path="emprestimos/relatorio" element={<RelatorioEmprestimos />} />
            <Route path="emprestimos/:id" element={<EmprestimoDetail />} />

            <Route element={<WriteOnly />}>
              <Route path="clientes/novo" element={<ClientForm />} />
              <Route path="clientes/:id/editar" element={<ClientForm />} />
              <Route path="cheques/novo" element={<ChequeForm />} />
              <Route path="cheques/:id/editar" element={<ChequeForm />} />
              <Route path="boletos/novo" element={<BoletoForm />} />
              <Route path="boletos/:id/editar" element={<BoletoForm />} />
              <Route path="operacoes/novo" element={<OperacaoForm />} />
              <Route path="operacoes/:id/editar" element={<OperacaoForm />} />
              <Route path="recebimentos/novo" element={<RecebimentoForm />} />
              <Route path="recebimentos/:id/editar" element={<RecebimentoForm />} />
              <Route path="emprestimos/novo" element={<EmprestimoForm />} />
              <Route path="emprestimos/:id/editar" element={<EmprestimoForm />} />
            </Route>

            <Route path="relatorios" element={<Relatorios />} />

            <Route path="configuracoes" element={<Settings />} />

            <Route element={<AdminOnly />}>
              <Route path="administracao" element={<Admin />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Route>

          <Route path="recibos/:id/imprimir" element={<ReciboPrint />} />
          <Route path="emprestimos/:id/duplicata" element={<EmprestimoPrint />} />
          <Route path="emprestimos/promissoria" element={<EmprestimoPromissoria />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
