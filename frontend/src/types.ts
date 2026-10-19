export type ColumnProfile = {
  column_id: string
  name: string
  type: 'number' | 'text' | 'boolean' | 'datetime'
  missing_count: number
  missing_rate: number
  unique_count: number
  whitespace_count: number
  case_variant_count: number
  outlier_count: number
  date_parse_rate: number
  sample_values?: unknown[]
  statistics?: Record<string, unknown>
}

export type DataProfile = {
  rows: number
  columns_count: number
  missing_cells: number
  duplicate_rows: number
  duplicate_headers: number
  missing_rate?: number
  completeness_score?: number
  completeness_calculation?: string
  type_counts?: Record<string, number>
  quality_issues?: QualityIssue[]
  columns: ColumnProfile[]
  sample_rows: Record<string, unknown>[]
}

export type QualityIssue = {
  issue_type: string
  columns: string[]
  count: number
  examples: unknown[]
  severity: 'low' | 'medium' | 'review' | 'high'
  recommendation: string
  confirmed: boolean
}

export type DatasetPreview = {
  columns: string[]
  column_ids: string[]
  rows: Record<string, unknown>[]
  page: number
  page_size: number
  total_rows: number
  total_pages: number
  version: 'original' | 'cleaned'
}

export type EdaResult = {
  version: 'original' | 'cleaned'
  profile: DataProfile
  charts: { kind: 'histogram' | 'bar' | 'time'; column: string; data: { bin?: string; label?: string; count: number }[] }[]
  correlation: { x: string; y: string; value: number }[]
  scatter: { x: string; y: string; data: { x: number; y: number }[] } | null
}

export type ChatResult = {
  answer: string
  intent: string
  version: 'original' | 'cleaned' | 'comparison'
  result: Record<string, unknown>[]
  chart: { kind: 'bar' | 'line'; label: string; data: { label: string; count: number }[] } | null
  source?: 'groq' | 'pandas' | 'rules'
  sources?: { row_number: number; score: number; snippet: string }[]
  retrieval?: { enabled: boolean; strategy: string | null; retrieved_count: number }
}

export type QualityReport = {
  filename: string
  original: { rows: number; columns: number; missing_cells: number; duplicate_rows: number; completeness_score: number }
  cleaned: { rows: number; columns: number; missing_cells: number; duplicate_rows: number; completeness_score: number } | null
  change_log: { timestamp: string; operations: { operation: string; column_name: string | null; reason: string }[]; summary: Record<string, unknown> }[]
  unresolved_issues: QualityIssue[]
  limitations: string[]
}

export type Action = {
  action_id: string
  operation: string
  column_id: string | null
  column_name: string | null
  parameters: Record<string, string>
  reason: string
  evidence: Record<string, number>
  risk: 'low' | 'medium' | 'review'
  requires_confirmation: boolean
}

export type PreviewResult = {
  plan_version: number
  action_ids: string[]
  summary: {
    rows_before: number
    rows_after: number
    columns_before: number
    columns_after: number
    changed_cells: number
    affected_rows: number
    duplicate_rows_removed: number
    outliers_flagged: number
    date_parse_failures: number
    applied_actions: { operation: string; column_name: string | null; reason: string }[]
  }
  before_rows: Record<string, unknown>[]
  after_rows: Record<string, unknown>[]
  warnings: string[]
}

export type Dataset = {
  dataset_id: string
  session_token: string
  filename: string
  size_bytes: number
  expires_in_seconds: number
  profile: DataProfile
}

export type CleaningPlan = {
  plan_version: number
  source: 'groq' | 'rules'
  notice: string
  actions: Action[]
}

export type ExportResult = {
  export_id: string
  filename: string
  summary: PreviewResult['summary']
  download_url: string
}
