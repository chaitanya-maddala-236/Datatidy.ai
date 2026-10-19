import { useEffect, useState, type FormEvent } from 'react'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { AlertTriangle, ArrowLeft, ArrowRight, Download, LockKeyhole, MessageSquareText, Search, Send, Sparkles } from 'lucide-react'
import { askDataset, downloadQualityReport, getDatasetPreview, getEda, getQualityReport } from './api'
import type { ChatResult, Dataset, DatasetPreview, EdaResult, QualityReport } from './types'

type Version = 'original' | 'cleaned'

function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="alert alert-error" role="alert"><AlertTriangle size={15} /><span>{message}</span>{onRetry && <button className="button button-quiet retry-button" type="button" onClick={onRetry}>Retry</button>}</div>
}

function VersionPicker({ value, onChange, hasCleaned }: { value: Version; onChange: (version: Version) => void; hasCleaned: boolean }) {
  return <label className="version-picker">DATA VERSION<select value={value} onChange={(event) => onChange(event.target.value as Version)}><option value="original">Original upload</option><option value="cleaned" disabled={!hasCleaned}>Cleaned working copy{hasCleaned ? '' : ' (not created)'}</option></select></label>
}

export function DataPreview({ dataset, hasCleaned }: { dataset: Dataset; hasCleaned: boolean }) {
  const [data, setData] = useState<DatasetPreview | null>(null)
  const [version, setVersion] = useState<Version>('original')
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [sortBy, setSortBy] = useState<string | undefined>()
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void getDatasetPreview(dataset.dataset_id, dataset.session_token, { page, pageSize: 20, search: query, sortBy, sortDir, version })
      .then((response) => { if (active) setData(response) })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load the preview.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [dataset.dataset_id, dataset.session_token, page, query, sortBy, sortDir, version, reload])

  function changeSort(columnId: string) {
    if (columnId === sortBy) setSortDir((current) => current === 'asc' ? 'desc' : 'asc')
    else { setSortBy(columnId); setSortDir('asc') }
    setPage(1)
  }

  return <section className="workspace-panel">
    <div className="workspace-panel-heading"><div><div className="eyebrow small"><span className="eyebrow-line" /> ROW INSPECTOR / LIVE DATA</div><h2>Data preview</h2><p>Search, sort, and page through the selected dataset version.</p></div><VersionPicker value={version} onChange={(next) => { setVersion(next); setPage(1) }} hasCleaned={hasCleaned} /></div>
    <form className="preview-toolbar" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(draft.trim()) }}><label className="preview-search"><Search size={15} /><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search across rows" aria-label="Search dataset rows" /><button type="submit" className="button button-quiet">Search</button></label><span>{data ? `${data.total_rows.toLocaleString()} matching rows` : 'Loading row count…'}</span></form>
    {error && <ErrorBlock message={error} onRetry={() => setReload((current) => current + 1)} />}
    <div className="panel table-preview-panel"><div className="table-wrap"><table className="profile-table full-data-table"><thead><tr><th>#</th>{data?.columns.map((column, index) => <th key={data.column_ids[index]}><button type="button" onClick={() => changeSort(data.column_ids[index])} aria-label={`Sort by ${column}`}>{column}{sortBy === data.column_ids[index] ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>)}</tr></thead><tbody>{data?.rows.map((row, rowIndex) => <tr key={`${page}-${rowIndex}`}><td>{(page - 1) * 20 + rowIndex + 1}</td>{data.columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? <span className="empty-cell">∅ null</span> : String(row[column])}</td>)}</tr>)}</tbody></table>{loading && <div className="table-loading">Reading rows…</div>}{!loading && data?.rows.length === 0 && <div className="empty-panel"><h3>No rows match</h3><p>Try a shorter search term or clear the search.</p></div>}</div></div>
    <div className="pagination-bar"><span>Page {data?.page ?? page} of {data?.total_pages ?? 1}</span><div><button className="button button-quiet" type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ArrowLeft size={14} /> Previous</button><button className="button button-quiet" type="button" disabled={!data || page >= data.total_pages || loading} onClick={() => setPage((current) => current + 1)}>Next <ArrowRight size={14} /></button></div></div>
  </section>
}

export function EdaWorkspace({ dataset, hasCleaned }: { dataset: Dataset; hasCleaned: boolean }) {
  const [version, setVersion] = useState<Version>('original')
  const [data, setData] = useState<EdaResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    void getEda(dataset.dataset_id, dataset.session_token, version)
      .then((response) => { if (active) { setData(response); setError('') } })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'EDA could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [dataset.dataset_id, dataset.session_token, version, reload])

  const profile = data?.profile
  const pairs = data?.correlation.filter((pair) => pair.x !== pair.y && pair.x < pair.y).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 10) ?? []
  const numericNames = profile?.columns.filter((column) => column.type === 'number').map((column) => column.name) ?? []
  const numericColumns = profile?.columns.filter((column) => column.type === 'number') ?? []
  return <section className="workspace-panel">
    <div className="workspace-panel-heading"><div><div className="eyebrow small"><span className="eyebrow-line" /> EXPLORATORY DATA ANALYSIS</div><h2>EDA workspace</h2><p>Charts and statistics are calculated from the uploaded dataset.</p></div><VersionPicker value={version} onChange={setVersion} hasCleaned={hasCleaned} /></div>
    {error && <ErrorBlock message={error} onRetry={() => setReload((current) => current + 1)} />}{loading && <div className="alert">Recomputing statistics…</div>}
    {profile && <>
      <div className="eda-summary-grid"><Summary label="COMPLETENESS" value={`${profile.completeness_score ?? 0}%`} note={profile.completeness_calculation ?? 'Non-missing cells'} /><Summary label="MISSING CELLS" value={profile.missing_cells.toLocaleString()} note={`${((profile.missing_rate ?? 0) * 100).toFixed(1)}% of all cells`} /><Summary label="EXACT DUPLICATES" value={profile.duplicate_rows.toLocaleString()} note="Rows identical across every column" /><Summary label="FIELD TYPES" value={`${profile.type_counts?.number ?? 0}N · ${profile.type_counts?.text ?? 0}T · ${profile.type_counts?.datetime ?? 0}D`} note="Numeric · text · datetime" /></div>
      <p className="calculation-note">Completeness = 100 × (1 − missing cells ÷ total cells). It describes coverage, not correctness.</p>
      <div className="eda-chart-grid">{data?.charts.map((chart) => <article className="eda-chart-card" key={`${chart.kind}-${chart.column}`}><div className="micro-label">{chart.kind.toUpperCase()} / {chart.column}</div><h3>{chart.column}</h3><ResponsiveContainer width="100%" height={230}>{chart.kind === 'time' ? <LineChart data={chart.data}><CartesianGrid strokeDasharray="3 3" stroke="#b7b3a9" /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} /><Tooltip /><Line dataKey="count" stroke="#111" strokeWidth={3} dot={{ fill: '#d8ff00', stroke: '#111', strokeWidth: 2, r: 4 }} /></LineChart> : <BarChart data={chart.data}><CartesianGrid strokeDasharray="3 3" stroke="#b7b3a9" /><XAxis dataKey={chart.kind === 'histogram' ? 'bin' : 'label'} tick={{ fontSize: 8 }} interval={0} angle={chart.kind === 'bar' ? -18 : 0} textAnchor={chart.kind === 'bar' ? 'end' : 'middle'} height={chart.kind === 'bar' ? 55 : 30} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} /><Tooltip /><Bar dataKey="count" fill="#d8ff00" stroke="#111" strokeWidth={1} /></BarChart>}</ResponsiveContainer><p className="chart-caption">{chart.kind === 'histogram' ? 'Value distribution · actual row counts' : chart.kind === 'time' ? 'Records per month · parseable dates' : 'Most frequent values · top categories'}</p></article>)}</div>
      {numericColumns.length > 0 && <section className="panel stats-panel"><div className="panel-heading"><div><div className="micro-label">NUMERIC DESCRIPTIVES</div><h2>Column statistics</h2></div></div><div className="table-wrap"><table className="profile-table"><thead><tr><th>FIELD</th><th>COUNT</th><th>MEAN</th><th>MEDIAN</th><th>STD. DEV.</th><th>MIN</th><th>MAX</th></tr></thead><tbody>{numericColumns.map((column) => <tr key={column.column_id}><td>{column.name}</td><td>{String(column.statistics?.count ?? '—')}</td><td>{String(column.statistics?.mean ?? '—')}</td><td>{String(column.statistics?.median ?? '—')}</td><td>{String(column.statistics?.std ?? '—')}</td><td>{String(column.statistics?.min ?? '—')}</td><td>{String(column.statistics?.max ?? '—')}</td></tr>)}</tbody></table></div></section>}
      {numericNames.length > 1 && <section className="panel correlation-panel"><div className="panel-heading"><div><div className="micro-label">NUMERIC ASSOCIATION</div><h2>Correlation heatmap</h2></div></div><CorrelationHeatmap names={numericNames} pairs={data?.correlation ?? []} /><p className="chart-caption">Correlation measures association; it does not establish causation. The list below ranks distinct pairs by absolute correlation.</p>{pairs.length > 0 && <div className="correlation-list">{pairs.map((pair) => <div key={`${pair.x}-${pair.y}`}><strong>{pair.x}</strong><span>↔</span><strong>{pair.y}</strong><b>{pair.value.toFixed(3)}</b></div>)}</div>}</section>}
      {data?.scatter && data.scatter.data.length > 0 && <article className="eda-chart-card scatter-card"><div className="micro-label">BIVARIATE SAMPLE / FIRST 500 VALID PAIRS</div><h3>{data.scatter.x} × {data.scatter.y}</h3><ResponsiveContainer width="100%" height={250}><ScatterChart><CartesianGrid strokeDasharray="3 3" stroke="#b7b3a9" /><XAxis dataKey="x" name={data.scatter.x} type="number" tick={{ fontSize: 9 }} /><YAxis dataKey="y" name={data.scatter.y} type="number" tick={{ fontSize: 9 }} /><Tooltip cursor={{ strokeDasharray: '3 3' }} /><Scatter data={data.scatter.data} fill="#d8ff00" stroke="#111" /></ScatterChart></ResponsiveContainer></article>}
      {(data?.charts.length ?? 0) === 0 && <div className="empty-panel"><h3>No chartable columns</h3><p>This dataset does not contain enough numeric, categorical, or date values for these charts.</p></div>}
    </>}
  </section>
}

function CorrelationHeatmap({ names, pairs }: { names: string[]; pairs: EdaResult['correlation'] }) {
  const matrixValue = (x: string, y: string) => pairs.find((pair) => pair.x === x && pair.y === y)?.value ?? pairs.find((pair) => pair.x === y && pair.y === x)?.value ?? 0
  return <div className="correlation-heatmap" style={{ gridTemplateColumns: `minmax(90px, 1.2fr) repeat(${names.length}, minmax(58px, 1fr))` }}><div className="heatmap-label">FIELD</div>{names.map((name) => <div className="heatmap-label" key={`top-${name}`}>{name}</div>)}{names.map((row) => <div className="heatmap-row" key={row}><strong>{row}</strong>{names.map((column) => { const value = matrixValue(row, column); const opacity = Math.min(.78, .18 + Math.abs(value) * .6); return <div key={`${row}-${column}`} className="heatmap-cell" style={{ backgroundColor: value < 0 ? `rgba(227, 41, 36, ${opacity})` : `rgba(216, 255, 0, ${opacity})` }} title={`${row} × ${column}: ${value.toFixed(3)}`}>{value.toFixed(2)}</div> })}</div>)}</div>
}

function Summary({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="metric-card"><div className="metric-top">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div>
}

type ChatMessage = { role: 'user' | 'assistant'; text: string; response?: ChatResult }

export function DatasetChat({ dataset, hasCleaned, apiKey }: { dataset: Dataset; hasCleaned: boolean; apiKey: string }) {
  const [version, setVersion] = useState<Version>('original')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [useRag, setUseRag] = useState(false)
  const metricColumn = dataset.profile.columns.find((column) => column.type === 'number')?.name
  const categoryColumn = dataset.profile.columns.find((column) => column.type === 'text')?.name
  const dateColumn = dataset.profile.columns.find((column) => column.type === 'datetime')?.name
  const suggestedQuestions = [
    'Summarize this dataset',
    'Which columns have the most missing values?',
    ...(categoryColumn ? [`Show the distribution of ${categoryColumn}`] : []),
    ...(metricColumn ? [`Show statistics for ${metricColumn}`, `Show rows where ${metricColumn} is greater than 0`] : ['Are there suspicious outliers?']),
    ...(dateColumn ? [`Show the trend over time by ${dateColumn}`] : []),
    'Explain the main quality issues',
    ...(hasCleaned ? ['Compare original and cleaned versions'] : []),
  ].slice(0, 7)
  async function submitQuestion(event?: FormEvent, text = question) {
    event?.preventDefault()
    const prompt = text.trim()
    if (!prompt || busy) return
    setError('')
    setQuestion('')
    setMessages((current) => [...current, { role: 'user', text: prompt }])
    setBusy(true)
    try {
      const history = messages.slice(-6).map((message) => ({ role: message.role, content: message.text }))
      const response = await askDataset(dataset.dataset_id, dataset.session_token, prompt, version, history, apiKey, useRag)
      setMessages((current) => [...current, { role: 'assistant', text: response.answer, response }])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The analysis could not be completed.')
    } finally { setBusy(false) }
  }
  return <section className="workspace-panel dataset-chat-workspace">
    <div className="workspace-panel-heading"><div><div className="eyebrow small"><span className="eyebrow-line" /> GROUNDED DATA QUESTIONS</div><h2>Chat with your data</h2><p>Analysis tools calculate exact values; optional local retrieval finds matching rows for evidence. No code is executed.</p></div><VersionPicker value={version} onChange={setVersion} hasCleaned={hasCleaned} /></div>
    <div className={`rag-consent ${useRag ? 'enabled' : ''}`}><label><input type="checkbox" checked={useRag} disabled={!apiKey.trim() || busy} onChange={(event) => setUseRag(event.target.checked)} /><span><strong>Use row retrieval for grounded answers</strong><small>Search locally with BM25; optionally send up to five matching row snippets to Groq.</small></span><LockKeyhole size={16} /></label><p>{apiKey.trim() ? `When Groq is used, your question, column names/types, and recent turns are sent for intent classification.${useRag ? ' This answer also sends up to five matching row snippets and the computed result to Groq.' : ''} The full CSV is never sent.` : 'Connect a Groq key to enable AI classification and optional RAG answers. Without it, supported pandas questions still work locally.'}</p></div>
    {error && <ErrorBlock message={error} />}
    <div className="chat-transcript" aria-live="polite">{messages.length === 0 ? <div className="chat-empty"><MessageSquareText size={25} /><h3>Ask a question about this dataset</h3><p>Answers include calculated results from the selected version.</p><div>{suggestedQuestions.map((item) => <button type="button" key={item} onClick={() => void submitQuestion(undefined, item)}>{item}<ArrowRight size={13} /></button>)}</div></div> : messages.map((message, index) => <article className={`data-chat-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === 'user' ? 'YOU' : `${message.response?.source === 'groq' ? 'GROQ GROUNDED' : message.response?.source === 'pandas' ? 'PANDAS ANALYSIS' : 'RULES ANALYSIS'} · ${message.response?.version.toUpperCase() ?? ''}`}</span><p>{message.text}</p>{message.response && <ChatResultView response={message.response} />}</article>)}{busy && <div className="alert"><Sparkles size={14} />{useRag ? 'Retrieving evidence and calculating…' : 'Classifying the question and calculating…'}</div>}</div>
    <form className="data-chat-form" onSubmit={(event) => void submitQuestion(event)}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about missing values, categories, statistics, correlations, or possible outliers…" rows={2} maxLength={1000} /><button className="button button-primary" type="submit" disabled={busy || !question.trim()}>{busy ? 'Calculating…' : 'Ask DataTidy'} <Send size={14} /></button></form>
    <p className="chat-data-note">Pandas calculates the answer; the language model explains those results. The app never uploads the entire CSV to Groq.</p>
  </section>
}

function ChatResultView({ response }: { response: ChatResult }) {
  const columns = response.result.length ? Object.keys(response.result[0]) : []
  return <div className="chat-result-block">{response.result.length > 0 && <div className="table-wrap chat-result-table"><table className="profile-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, ' ')}</th>)}</tr></thead><tbody>{response.result.slice(0, 20).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? '—' : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column])}</td>)}</tr>)}</tbody></table></div>}{response.chart && <div className="chat-inline-chart"><div className="micro-label">CALCULATED {response.chart.kind === 'line' ? 'TREND' : 'FREQUENCY'} / {response.chart.label}</div><ResponsiveContainer width="100%" height={190}>{response.chart.kind === 'line' ? <LineChart data={response.chart.data}><CartesianGrid strokeDasharray="3 3" stroke="#b7b3a9" /><XAxis dataKey="label" tick={{ fontSize: 8 }} interval={0} angle={-15} textAnchor="end" height={55} /><YAxis tick={{ fontSize: 9 }} /><Tooltip /><Line dataKey="count" stroke="#111" strokeWidth={3} dot={{ fill: '#d8ff00', stroke: '#111', strokeWidth: 2, r: 4 }} /></LineChart> : <BarChart data={response.chart.data}><CartesianGrid strokeDasharray="3 3" stroke="#b7b3a9" /><XAxis dataKey="label" tick={{ fontSize: 8 }} interval={0} angle={-15} textAnchor="end" height={55} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} /><Tooltip /><Bar dataKey="count" fill="#d8ff00" stroke="#111" /></BarChart>}</ResponsiveContainer></div>}{(response.sources?.length ?? 0) > 0 && <section className="rag-sources"><div className="micro-label">RETRIEVED ROW EVIDENCE / {response.sources?.length}</div>{response.sources?.map((source) => <details key={source.row_number}><summary>Source row {source.row_number} <span>BM25 {source.score.toFixed(2)}</span></summary><p>{source.snippet}</p></details>)}</section>}</div>
}

export function ReportWorkspace({ dataset, onDownloadCsv, onReset }: { dataset: Dataset; onDownloadCsv?: () => void; onReset?: () => void }) {
  const [report, setReport] = useState<QualityReport | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void getQualityReport(dataset.dataset_id, dataset.session_token).then((data) => { if (active) setReport(data) }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Report could not be loaded.') })
    return () => { active = false }
  }, [dataset.dataset_id, dataset.session_token])
  async function downloadReport() {
    setBusy(true); setError('')
    try { await downloadQualityReport(dataset.dataset_id, dataset.session_token) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Report download failed.') }
    finally { setBusy(false) }
  }
  return <section className="workspace-panel report-workspace">
    <div className="workspace-panel-heading"><div><div className="eyebrow small"><span className="eyebrow-line" /> OUTPUT / QUALITY RECORD</div><h2>Export & report</h2><p>Compare the source with the approved working copy and inspect unresolved quality signals.</p></div><div className="report-download-actions"><button className="button button-quiet" onClick={() => void downloadReport()} disabled={busy}><Download size={15} />{busy ? 'Preparing…' : 'Download JSON report'}</button>{onDownloadCsv && <button className="button button-primary" onClick={onDownloadCsv}><Download size={15} />Cleaned CSV</button>}{onReset && report?.cleaned && <button className="button button-quiet" onClick={onReset} disabled={busy}>Reset working copy</button>}</div></div>
    {error && <ErrorBlock message={error} />}{report && <>
      <div className="comparison-grid"><ReportSide title="ORIGINAL UPLOAD" values={report.original} /><ReportSide title="CLEANED WORKING COPY" values={report.cleaned} /></div>
      <section className="panel report-log"><div className="panel-heading"><div><div className="micro-label">APPROVED CHANGE HISTORY</div><h2>Operation log</h2></div><span className="profile-count">{report.change_log.length} BATCHES</span></div>{report.change_log.length ? report.change_log.map((entry, index) => <div className="report-log-row" key={`${entry.timestamp}-${index}`}><strong>{new Date(entry.timestamp).toLocaleString()}</strong><span>{entry.operations.map((item) => `${item.operation.replace(/_/g, ' ')}${item.column_name ? ` · ${item.column_name}` : ''}`).join(' / ')}</span></div>) : <p className="report-empty">No approved changes have been applied yet. The source upload remains unchanged.</p>}</section>
      <section className="panel report-issues"><div className="panel-heading"><div><div className="micro-label">POST-CHECK · CURRENT VERSION</div><h2>Unresolved quality signals</h2></div><span className="profile-count">{report.unresolved_issues.length} SIGNALS</span></div>{report.unresolved_issues.length ? report.unresolved_issues.map((issue, index) => <article className="report-issue" key={`${issue.issue_type}-${index}`}><div><span className={`risk-pill ${issue.severity === 'review' || issue.severity === 'high' ? 'review' : issue.severity === 'medium' ? 'medium' : ''}`}>{issue.severity}</span><strong>{issue.issue_type.replace(/_/g, ' ')}</strong><span>{issue.columns.join(', ') || 'Dataset rows'} · {issue.count.toLocaleString()}</span></div><p>{issue.recommendation}</p></article>) : <p className="report-empty">No current quality signals were detected by these checks.</p>}</section>
      <ul className="report-limitations">{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
    </>}
  </section>
}

function ReportSide({ title, values }: { title: string; values: QualityReport['original'] | QualityReport['cleaned'] }) {
  return <article className="report-side"><div className="micro-label">{title}</div>{values ? <div><strong>{values.rows.toLocaleString()}</strong><span>rows</span><strong>{values.columns}</strong><span>columns</span><strong>{values.completeness_score}%</strong><span>complete</span><strong>{values.missing_cells.toLocaleString()}</strong><span>missing</span></div> : <p>Apply an approved cleaning plan to create a working copy.</p>}</article>
}
