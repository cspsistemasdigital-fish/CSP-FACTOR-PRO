import { useEffect, useState } from 'react'
import api from '../../api/client'

/** Render an authenticated image without exposing the Bearer token in a URL. */
export default function ProtectedImage({ url, alt = '', className, ...rest }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let active = true
    let objectUrl = null
    api
      .get(url, { responseType: 'blob' })
      .then((response) => {
        objectUrl = window.URL.createObjectURL(
          new Blob([response.data], { type: response.headers['content-type'] || 'image/jpeg' }),
        )
        if (active) setSrc(objectUrl)
        else window.URL.revokeObjectURL(objectUrl)
      })
      .catch(() => {})
    return () => {
      active = false
      if (objectUrl) window.URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  return <img src={src} alt={alt} className={className} {...rest} />
}
