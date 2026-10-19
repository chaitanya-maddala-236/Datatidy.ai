import type { ChatResult, CleaningPlan, DataProfile, Dataset, DatasetPreview, EdaResult, ExportResult, PreviewResult, QualityReport } from './types'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (token) headers.set('X-Session-Token', token)
  if (init?.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers })
  } catch {
    throw new Error('Could not reach the DataTidy API. Check that the backend is running, then retry.')
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}). Please try again.`
    try {
      const payload = await response.json()
      const detail = payload.detail
      message = (typeof detail === 'string' ? detail : detail?.message)
        ?? payload.error?.message
        ?? payload.message
        ?? message
    } catch { /* keep status-aware fallback */ }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export async function validateGroqKey(apiKey: string): Promise<{ connected: boolean; provider: string; model_count: number }> {
  return request('/api/groq/connect', undefined, {
    method: 'POST',
    headers: { 'X-Groq-API-Key': apiKey.trim() },
  })
}

export async function uploadCsv(file: File): Promise<Dataset> {
  const body = new FormData()
  body.append('file', file)
  return request<Dataset>('/api/datasets', undefined, { method: 'POST', body })
}

export async function generatePlan(datasetId: string, token: string, mode: 'groq' | 'rules', userRequest = '', apiKey = ''): Promise<CleaningPlan> {
  const headers = new Headers()
  if (mode === 'groq' && apiKey.trim()) headers.set('X-Groq-API-Key', apiKey.trim())
  return request<CleaningPlan>(`/api/datasets/${datasetId}/plan`, token, {
    method: 'POST', headers, body: JSON.stringify({ mode, user_request: userRequest }),
  })
}

export async function previewSelection(datasetId: string, token: string, planVersion: number, actionIds: string[]): Promise<PreviewResult> {
  return request<PreviewResult>(`/api/datasets/${datasetId}/preview`, token, {
    method: 'POST', body: JSON.stringify({ plan_version: planVersion, action_ids: actionIds }),
  })
}

export async function applySelection(datasetId: string, token: string, planVersion: number, actionIds: string[]): Promise<ExportResult> {
  return request<ExportResult>(`/api/datasets/${datasetId}/apply`, token, {
    method: 'POST', body: JSON.stringify({ plan_version: planVersion, action_ids: actionIds, confirm: true }),
  })
}

export async function clearDataset(datasetId: string, token: string): Promise<void> {
  await request<{ cleared: boolean }>(`/api/datasets/${datasetId}`, token, { method: 'DELETE' })
}

export async function downloadExport(token: string, exportId: string, filename: string): Promise<void> {
  const headers = new Headers({ 'X-Session-Token': token })
  const response = await fetch(`${API_BASE}/api/exports/${exportId}`, { headers })
  if (!response.ok) throw new Error('The download expired. Clean the file again to create another copy.')
  const blob = await response.blob()
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(link.href)
}

export async function getDatasetPreview(datasetId: string, token: string, options: { page?: number; pageSize?: number; search?: string; sortBy?: string; sortDir?: 'asc' | 'desc'; version?: 'original' | 'cleaned' }): Promise<DatasetPreview> {
  const params = new URLSearchParams({
    page: String(options.page ?? 1),
    page_size: String(options.pageSize ?? 20),
    search: options.search ?? '',
    version: options.version ?? 'original',
  })
  if (options.sortBy) params.set('sort_by', options.sortBy)
  if (options.sortDir) params.set('sort_dir', options.sortDir)
  return request<DatasetPreview>(`/api/datasets/${datasetId}/preview?${params.toString()}`, token)
}

export async function getEda(datasetId: string, token: string, version: 'original' | 'cleaned'): Promise<EdaResult> {
  return request<EdaResult>(`/api/datasets/${datasetId}/eda?version=${version}`, token)
}

export async function askDataset(datasetId: string, token: string, question: string, version: 'original' | 'cleaned', history: { role: 'user' | 'assistant'; content: string }[], apiKey = '', useRag = false): Promise<ChatResult> {
  const headers = new Headers()
  if (apiKey.trim()) headers.set('X-Groq-API-Key', apiKey.trim())
  return request<ChatResult>(`/api/datasets/${datasetId}/chat`, token, {
    method: 'POST',
    headers,
    body: JSON.stringify({ question, version, history: history.slice(-8), use_rag: useRag }),
  })
}

export async function getQualityReport(datasetId: string, token: string): Promise<QualityReport> {
  return request<QualityReport>(`/api/datasets/${datasetId}/report`, token)
}

export async function getActiveProfile(datasetId: string, token: string): Promise<DataProfile> {
  const result = await request<{ profile: DataProfile }>(`/api/datasets/${datasetId}/profile`, token)
  return result.profile
}

export async function resetWorkingCopy(datasetId: string, token: string): Promise<void> {
  await request<{ reset: boolean }>(`/api/datasets/${datasetId}/reset`, token, { method: 'POST' })
}

export async function downloadQualityReport(datasetId: string, token: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/datasets/${datasetId}/report/download`, { headers: { 'X-Session-Token': token } })
  if (!response.ok) throw new Error('The quality report could not be downloaded.')
  const blob = await response.blob()
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${datasetId.slice(0, 8)}_quality_report.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(link.href)
}
