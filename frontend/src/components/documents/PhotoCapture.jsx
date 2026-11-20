import { useCallback, useEffect, useState } from 'react'
import { downloadProtectedFile, openProtectedFile } from '../../api'
import { apiError } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import ConfirmDialog from '../ui/ConfirmDialog'
import ProtectedImage from '../ui/ProtectedImage'

/**
 * Etapa 8 — capture several photos one by one on a phone/tablet, keep them in
 * a queue and upload them afterwards. Each file is sent in its own request so
 * the 10 MB per-request limit is respected no matter how many photos are taken.
 */
export default function PhotoCapture({ photosApi, documentId, code, canWrite }) {
  const toast = useToast()
  const [photos, setPhotos] = useState([])
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const [removing, setRemoving] = useState(null)
  const [removingBusy, setRemovingBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await photosApi.photos(documentId)
      setPhotos(data.items || [])
    } catch (requestError) {
      toast.error('Não foi possível carregar as fotos', apiError(requestError).message)
    } finally {
      setLoading(false)
    }
  }, [photosApi, documentId, toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    return () => {
      queue.forEach((entry) => window.URL.revokeObjectURL(entry.preview))
    }
    // The previews belong to the mounted queue; revoking on unmount is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addFiles = (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (images.length < files.length) {
      toast.warning('Alguns arquivos foram ignorados', 'Apenas imagens podem ser enviadas como foto.')
    }
    if (!images.length) return
    setQueue((current) => [
      ...current,
      ...images.map((file, index) => ({
        key: `${Date.now()}-${index}-${file.name}`,
        file,
        preview: window.URL.createObjectURL(file),
      })),
    ])
  }

  const handleInput = (event) => {
    addFiles(event.target.files)
    event.target.value = '' // allow taking another picture with the same input
  }

  const dropQueued = (key) => {
    setQueue((current) => {
      window.URL.revokeObjectURL(current.find((entry) => entry.key === key)?.preview)
      return current.filter((entry) => entry.key !== key)
    })
  }

  const upload = async () => {
    if (!queue.length || uploading) return
    setUploading(true)
    const sentKeys = []
    const failedNames = []
    for (let index = 0; index < queue.length; index += 1) {
      const entry = queue[index]
      setProgress(`Enviando ${index + 1} de ${queue.length}…`)
      try {
        await photosApi.uploadPhotos(documentId, [entry.file])
        sentKeys.push(entry.key)
      } catch (requestError) {
        failedNames.push(entry.file.name)
      }
    }
    setUploading(false)
    setProgress('')
    if (sentKeys.length) {
      setQueue((current) =>
        current.filter((entry) => {
          if (sentKeys.includes(entry.key)) {
            window.URL.revokeObjectURL(entry.preview)
            return false
          }
          return true
        }),
      )
      toast.success(
        'Fotos enviadas',
        `${sentKeys.length} foto(s) vinculada(s) a ${code}.`,
      )
      load()
    }
    if (failedNames.length) {
      toast.error(
        'Algumas fotos não foram enviadas',
        `${failedNames.length} foto(s) ficaram na fila: ${failedNames.join(', ')}.`,
      )
    }
  }

  const photoUrl = (photo) =>
    photo.legacy ? photosApi.attachmentUrl(documentId) : photosApi.photoUrl(documentId, photo.id)

  const openPhoto = async (photo) => {
    try {
      await openProtectedFile(photoUrl(photo))
    } catch (requestError) {
      toast.error('Não foi possível abrir a foto', requestError?.message || 'Tente novamente.')
    }
  }

  const downloadPhoto = async (photo) => {
    try {
      await downloadProtectedFile(
        photoUrl(photo),
        `${code}-${photo.name || 'foto'}`,
      )
    } catch (requestError) {
      toast.error('Não foi possível baixar a foto', requestError?.message || 'Tente novamente.')
    }
  }

  const confirmRemove = async () => {
    if (!removing) return
    setRemovingBusy(true)
    try {
      await photosApi.removePhoto(documentId, removing.id)
      toast.success('Foto removida', 'A foto foi excluída e a ação foi registrada na auditoria.')
      setRemoving(null)
      load()
    } catch (requestError) {
      toast.error('Não foi possível remover a foto', apiError(requestError).message)
      setRemoving(null)
    } finally {
      setRemovingBusy(false)
    }
  }

  return (
    <div className="photo-capture">
      <div className="photo-capture-head">
        <div>
          <strong>Fotos do documento</strong>
          <p className="panel-hint">
            Tire uma foto por vez, repita quantas vezes precisar e envie tudo depois. ideal para celulares
            e tablets com câmera.
          </p>
        </div>
        <span className="fp-badge fp-badge-neutral">
          {photos.length + queue.length} foto(s)
        </span>
      </div>

      {canWrite && (
        <div className="photo-capture-controls">
          <label className="btn btn-outline-primary fp-photo-button">
            <i className="bi bi-camera-fill" /> Tirar foto
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple={false}
              onChange={handleInput}
              aria-label="Tirar foto do documento"
              hidden
            />
          </label>
          <label className="btn btn-light fp-photo-button">
            <i className="bi bi-images" /> Escolher da galeria
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleInput}
              aria-label="Escolher fotos da galeria"
              hidden
            />
          </label>
        </div>
      )}

      {queue.length > 0 && (
        <div className="photo-queue">
          <div className="photo-queue-title">
            <span>Fila para envio ({queue.length})</span>
            {canWrite && !uploading && (
              <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => {
                queue.forEach((entry) => window.URL.revokeObjectURL(entry.preview))
                setQueue([])
              }}>
                Limpar fila
              </button>
            )}
          </div>
          <div className="photo-grid">
            {queue.map((entry) => (
              <div className="photo-tile" key={entry.key}>
                <img src={entry.preview} alt="Foto aguardando envio" />
                {canWrite && !uploading && (
                  <button
                    type="button"
                    className="photo-tile-remove"
                    onClick={() => dropQueued(entry.key)}
                    aria-label={`Remover ${entry.file.name} da fila`}
                    title="Remover da fila"
                  >
                    <i className="bi bi-x-lg" />
                  </button>
                )}
                <span className="photo-tile-name">{entry.file.name}</span>
              </div>
            ))}
          </div>
          {canWrite && (
            <button
              type="button"
              className="btn btn-primary w-100 mt-2"
              disabled={uploading}
              onClick={upload}
            >
              {uploading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> {progress}
                </>
              ) : (
                <>
                  <i className="bi bi-cloud-arrow-up" /> Enviar {queue.length} foto(s)
                </>
              )}
            </button>
          )}
        </div>
      )}

      <div className="photo-gallery">
        <span className="photo-queue-title">Fotos salvas ({photos.length})</span>
        {loading ? (
          <p className="panel-hint">Carregando fotos…</p>
        ) : photos.length ? (
          <div className="photo-grid">
            {photos.map((photo, index) => (
              <div className="photo-tile" key={photo.id ?? `legacy-${index}`}>
                <ProtectedImage
                  url={photoUrl(photo)}
                  alt={photo.name || `Foto ${index + 1}`}
                  onClick={() => openPhoto(photo)}
                />
                <span className="photo-tile-name">{photo.name || 'Anexo'}</span>
                <div className="photo-tile-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-light"
                    onClick={() => openPhoto(photo)}
                    aria-label={`Visualizar ${photo.name || 'foto'}`}
                    title="Visualizar"
                  >
                    <i className="bi bi-eye" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-light"
                    onClick={() => downloadPhoto(photo)}
                    aria-label={`Baixar ${photo.name || 'foto'}`}
                    title="Baixar"
                  >
                    <i className="bi bi-download" />
                  </button>
                  {canWrite && !photo.legacy && (
                    <button
                      type="button"
                      className="btn btn-sm btn-link text-danger"
                      onClick={() => setRemoving(photo)}
                      aria-label={`Remover ${photo.name || 'foto'}`}
                      title="Remover"
                    >
                      <i className="bi bi-trash3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="panel-hint">Nenhuma foto salva neste registro.</p>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remover foto?"
        message={`A foto ${removing?.name || ''} será excluída do armazenamento e a ação registrada na auditoria.`}
        confirmLabel="Remover foto"
        loading={removingBusy}
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
      />
    </div>
  )
}
