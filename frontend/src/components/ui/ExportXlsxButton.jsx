import { useState } from 'react'
import { listExportApi } from '../../api'
import { apiError } from '../../api/client'
import { useToast } from '../../context/ToastContext'

/**
 * Shared "Exportar Excel" action for every list screen.
 * `params` must be the same filters used by the list request (without page).
 */
export default function ExportXlsxButton({ resource, params = {}, label = 'Exportar Excel' }) {
  const [exporting, setExporting] = useState(false)
  const toast = useToast()

  const handleExport = async () => {
    setExporting(true)
    try {
      await listExportApi.exportXlsx(resource, params)
      toast.success('Planilha exportada', 'Os dados salvos foram exportados para o Excel.')
    } catch (requestError) {
      toast.error('Não foi possível exportar', apiError(requestError).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <button
      type="button"
      className="btn btn-outline-primary"
      onClick={handleExport}
      disabled={exporting}
      aria-label={`Exportar ${resource} para Excel`}
      title="Baixar todos os registros filtrados em uma planilha Excel"
    >
      <i className={`bi ${exporting ? 'bi-arrow-repeat spin' : 'bi-file-earmark-excel'}`} aria-hidden="true" />{' '}
      {exporting ? 'Exportando...' : label}
    </button>
  )
}
