import axios from 'axios'

let accessToken = null
let handlers = { onRefreshed: null, onLost: null }
let refreshPromise = null

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  withCredentials: true,
})

export function setAccessToken(token) {
  accessToken = token || null
}

export function setSessionHandlers(next) {
  handlers = { ...handlers, ...next }
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post('/api/auth/refresh', null, { withCredentials: true, timeout: 20000 })
      .then((response) => {
        const data = response.data
        setAccessToken(data.access_token)
        handlers.onRefreshed?.(data)
        return data
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

/** Silent session restore on application start (httpOnly refresh cookie). */
export async function bootstrapSession() {
  try {
    return await refreshAccessToken()
  } catch {
    return null
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error
    const isAuthCall = config?.url?.includes('/auth/')
    if (response?.status === 401 && config && !config._retry && !isAuthCall) {
      config._retry = true
      try {
        const data = await refreshAccessToken()
        config.headers.Authorization = `Bearer ${data.access_token}`
        return api(config)
      } catch {
        handlers.onLost?.()
        return Promise.reject(error)
      }
    }
    return Promise.reject(error)
  },
)

/** Normalize backend errors for forms and toasts. */
export function apiError(error) {
  const data = error?.response?.data
  return {
    status: error?.response?.status ?? 0,
    message: data?.message || 'Não foi possível concluir a operação. Verifique sua conexão.',
    errors: data?.errors || {},
  }
}

export default api
