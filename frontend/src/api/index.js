import api from './client'

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  changePassword: (current_password, new_password) =>
    api.post('/auth/change-password', { current_password, new_password }),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token, new_password) => api.post('/auth/reset-password', { token, new_password }),
}

export const dashboardApi = {
  summary: (params) => api.get('/dashboard/summary', { params }),
}

export const clientsApi = {
  list: (params) => api.get('/clients', { params }),
  options: (search, onlyActive = true) =>
    api.get('/clients/options', { params: { search, only_active: onlyActive ? 1 : 0 } }),
  get: (id) => api.get(`/clients/${id}`),
  history: (id) => api.get(`/clients/${id}/history`),
  create: (payload) => api.post('/clients', payload),
  update: (id, payload) => api.put(`/clients/${id}`, payload),
  remove: (id) => api.delete(`/clients/${id}`),
}

function documentApi(base) {
  return {
    list: (params) => api.get(base, { params }),
    banks: () => api.get(`${base}/banks`),
    get: (id) => api.get(`${base}/${id}`),
    create: (payload) => api.post(base, payload),
    update: (id, payload) => api.put(`${base}/${id}`, payload),
    changeStatus: (id, status) => api.patch(`${base}/${id}/status`, { status }),
    remove: (id) => api.delete(`${base}/${id}`),
    uploadAttachment: (id, file) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`${base}/${id}/attachment`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    attachmentUrl: (id) => `${base}/${id}/attachment`,
    removeAttachment: (id) => api.delete(`${base}/${id}/attachment`),
  }
}

export const chequesApi = documentApi('/cheques')
export const boletosApi = documentApi('/boletos')

export const operationsApi = {
  list: (params) => api.get('/operations', { params }),
  availableDocuments: (params) => api.get('/operations/available-documents', { params }),
  get: (id) => api.get(`/operations/${id}`),
  create: (payload) => api.post('/operations', payload),
  update: (id, payload) => api.put(`/operations/${id}`, payload),
  changeStatus: (id, status) => api.patch(`/operations/${id}/status`, { status }),
  remove: (id) => api.delete(`/operations/${id}`),
}

export const receiptsApi = {
  list: (params) => api.get('/receipts', { params }),
  openDocuments: (params) => api.get('/receipts/open-documents', { params }),
  get: (id) => api.get(`/receipts/${id}`),
  recibo: (id) => api.get(`/receipts/${id}/recibo`),
  create: (payload) => api.post('/receipts', payload),
  update: (id, payload) => api.put(`/receipts/${id}`, payload),
  remove: (id) => api.delete(`/receipts/${id}`),
  uploadAttachment: (id, file) => {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/receipts/${id}/attachment`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  attachmentUrl: (id) => `/receipts/${id}/attachment`,
  removeAttachment: (id) => api.delete(`/receipts/${id}/attachment`),
}

export const usersApi = {
  list: () => api.get('/users'),
  create: (payload) => api.post('/users', payload),
  update: (id, payload) => api.put(`/users/${id}`, payload),
  resetPassword: (id, password) => api.post(`/users/${id}/reset-password`, { password }),
  auditLogs: (params) => api.get('/users/audit-logs', { params }),
}

export const settingsApi = {
  get: () => api.get('/settings/company'),
  update: (payload) => api.put('/settings/company', payload),
}

export const reportsApi = {
  summary: (params) => api.get('/reports/summary', { params }),
  whatsapp: (clientId, params) =>
    api.get('/reports/whatsapp', { params: { ...params, client_id: clientId } }),
  exportPdf: (params) =>
    downloadProtectedFile('/reports/export/pdf', exportFilename('pdf'), params),
  exportXlsx: (params) =>
    downloadProtectedFile('/reports/export/xlsx', exportFilename('xlsx'), params),
  filters: () => api.get('/reports/filters'),
  saveFilter: (payload) => api.post('/reports/filters', payload),
  removeFilter: (id) => api.delete(`/reports/filters/${id}`),
}

function exportFilename(extension) {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `relatorio-factor-pro-${stamp}.${extension}`
}

export async function downloadProtectedFile(url, filename, params) {
  const response = await api.get(url, { responseType: 'blob', params })
  const blobUrl = window.URL.createObjectURL(new Blob([response.data]))
  const anchor = document.createElement('a')
  anchor.href = blobUrl
  anchor.download = filename || 'anexo'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => window.URL.revokeObjectURL(blobUrl), 2000)
}

/** Open an authenticated file (attachment) in a new tab without exposing the token. */
export async function openProtectedFile(url) {
  const response = await api.get(url, { responseType: 'blob' })
  const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: response.headers['content-type'] }))
  const opened = window.open(blobUrl, '_blank', 'noopener,noreferrer')
  if (!opened) {
    window.URL.revokeObjectURL(blobUrl)
    throw new Error('O navegador bloqueou a nova aba. Permita pop-ups para visualizar o anexo.')
  }
  setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000)
}
