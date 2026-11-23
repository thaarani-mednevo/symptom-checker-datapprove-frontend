// src/api.js
async function req(url, opts) {
  const res = await fetch(url, opts)
  let body = null
  try { body = await res.json() } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`)
  return body
}

export const getModules = () => req('/api/modules/')
export const getSymptoms = (slug, q = '') =>
  req(`/api/modules/${slug}/symptoms/?q=${encodeURIComponent(q)}`)
export const getDetail = (slug, kind, code) =>
  req(`/api/modules/${slug}/symptoms/${kind}/${encodeURIComponent(code)}/`)

const post = (url, body) =>
  req(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const review = (b) => post('/api/review/', b)
export const reviewBulk = (b) => post('/api/review/bulk/', b)
export const getLog = (slug) => req(`/api/review/log/?module=${encodeURIComponent(slug || '')}`)

// Doctor edits an item. Body: { module, entity_type, key, fields: { <rowField>: <newValue> }, reviewer }
// Expected backend behaviour: save the new values, log the change, set status back to "pending". May return { item: {...updated row} }.
export const editItem = (b) => post('/api/review/edit/', b)

// Data files (JSON + seed CSV) the backend writes decisions into
export const getFiles = (slug) => req(`/api/modules/${slug}/files/`)
export const getFileView = (slug, kind, path) =>
  req(`/api/modules/${slug}/files/view/?kind=${kind}&path=${encodeURIComponent(path)}`)
export const fileDownloadUrl = (slug, kind, path) =>
  `/api/modules/${slug}/files/download/?kind=${kind}&path=${encodeURIComponent(path)}`
export const moduleDownloadUrl = (slug, format = 'all') => `/api/modules/${slug}/download/?format=${format}`