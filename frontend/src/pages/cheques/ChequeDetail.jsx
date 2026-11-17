import { chequesApi } from '../../api'
import DocumentDetailPage from '../../components/documents/DocumentDetailPage'

const config = {
  api: chequesApi,
  basePath: '/cheques',
  title: 'Cheque',
  icon: 'bi-journal-check',
  nominalLabel: 'Valor nominal',
  party: { label: 'Emitente', nameKey: 'issuer_name', documentKey: 'issuer_document' },
  fields: [
    { key: 'number', label: 'Número do cheque' },
    { key: 'bank', label: 'Banco' },
    { key: 'agency', label: 'Agência' },
    { key: 'account', label: 'Conta' },
    { key: 'identifier', label: 'Identificação interna' },
  ],
  costs: [
    { key: 'discount_amount', label: 'Desconto' },
    { key: 'interest_amount', label: 'Juros' },
    { key: 'other_expenses', label: 'Outras despesas' },
  ],
}

export default function ChequeDetail() {
  return <DocumentDetailPage config={config} />
}
