import { chequesApi } from '../../api'
import DocumentsListPage from '../../components/documents/DocumentsListPage'

const config = {
  kind: 'CHEQUE',
  api: chequesApi,
  basePath: '/cheques',
  title: 'Cheques',
  subtitle: 'Controle de cheques com valores informados manualmente, vencimentos e divergências destacadas.',
  icon: 'bi-journal-check',
  nominalLabel: 'Valor nominal',
  newLabel: 'Novo cheque',
}

export default function ChequesList() {
  return <DocumentsListPage config={config} />
}
