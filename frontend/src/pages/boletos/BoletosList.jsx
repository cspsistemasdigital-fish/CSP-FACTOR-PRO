import { boletosApi } from '../../api'
import DocumentsListPage from '../../components/documents/DocumentsListPage'

const config = {
  kind: 'BOLETO',
  api: boletosApi,
  basePath: '/boletos',
  title: 'Boletos',
  subtitle: 'Controle de boletos com valores originais, vencimentos e divergências sempre visíveis.',
  icon: 'bi-receipt',
  nominalLabel: 'Valor original',
  newLabel: 'Novo boleto',
}

export default function BoletosList() {
  return <DocumentsListPage config={config} />
}
