import { boletosApi } from '../../api'
import DocumentDetailPage from '../../components/documents/DocumentDetailPage'

const config = {
  api: boletosApi,
  basePath: '/boletos',
  title: 'Boleto',
  icon: 'bi-receipt',
  nominalLabel: 'Valor original',
  party: {
    label: 'Beneficiário',
    nameKey: 'beneficiary_name',
    documentKey: 'beneficiary_document',
  },
  fields: [
    { key: 'identifier', label: 'Identificação do boleto' },
    { key: 'barcode', label: 'Linha digitável' },
    { key: 'bank', label: 'Banco emissor' },
  ],
  costs: [
    { key: 'discount_amount', label: 'Juros / desconto' },
    { key: 'other_expenses', label: 'Outras despesas' },
  ],
}

export default function BoletoDetail() {
  return <DocumentDetailPage config={config} />
}
