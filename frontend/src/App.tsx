import { useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, ArrowRight, Check, CheckCircle2, CloudUpload, Download, Eye, EyeOff, FileCheck2, FileSpreadsheet, FlaskConical, KeyRound, LockKeyhole, MessageSquareText, RefreshCw, ScanSearch, Send, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { applySelection, clearDataset, downloadExport, generatePlan, getActiveProfile, previewSelection, resetWorkingCopy, uploadCsv, validateGroqKey } from './api'
import { DataPreview, DatasetChat, EdaWorkspace, ReportWorkspace } from './DataWorkspace'
import type { Action, CleaningPlan, Dataset, ExportResult, PreviewResult } from './types'

type Tab = 'overview' | 'preview' | 'eda' | 'preprocessing' | 'chat' | 'report'
const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', icon: Activity }, { id: 'preview', label: 'Data Preview', icon: FileSpreadsheet }, { id: 'eda', label: 'EDA', icon: ScanSearch },
  { id: 'preprocessing', label: 'Preprocessing', icon: Sparkles }, { id: 'chat', label: 'Chat with Data', icon: MessageSquareText }, { id: 'report', label: 'Export & Report', icon: Download },
]
const sampleCsv = `customer_id,name,email,spend,signup_date,active
1001,  Maya Chen ,MAYA@example.com,120.5,2024-01-05,yes
1002,Leo Park,leo@example.com,,05/16/2024,true
1003,  maya chen,maya@example.com,120.5,2024/01/05,Y
1004,Sam Rivera,sam@example.com,88.0,2024-06-11,no
1005,Noah Reed,noah@example.com,95.3,June 14 2024,false
1006,Ava Patel,ava@example.com,9999,2024-07-02,yes
1007,Jamie Fox,jamie@example.com,,2024-08-19,YES
1008,Kim Wu,kim@example.com,106.0,2024-09-01,0
1009,Sam Rivera,sam@example.com,88.0,2024-06-11,no
`
const operationTitles: Record<string, string> = { fill_missing: 'Fill missing values', trim_whitespace: 'Trim extra spaces', normalize_case: 'Normalize letter case', remove_exact_duplicates: 'Remove exact duplicate rows', parse_dates: 'Standardize date values', standardize_boolean: 'Standardize yes / no values', flag_outliers: 'Flag unusual numeric values' }
const bytesLabel = (value: number) => value < 1048576 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1048576).toFixed(1)} MB`
const showCell = (value: unknown) => value === null || value === undefined || value === '' ? <span className="empty-cell">∅ null</span> : String(value)

export default function App() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [groqKey, setGroqKey] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)
  const [groqConnected, setGroqConnected] = useState(false)
  const [groqModelCount, setGroqModelCount] = useState<number | null>(null)
  const [groqError, setGroqError] = useState('')
  const [groqAcknowledged, setGroqAcknowledged] = useState(false)
  const [mode, setMode] = useState<'groq' | 'rules'>('groq')
  const [plan, setPlan] = useState<CleaningPlan | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [requestText, setRequestText] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const selectedActions = plan?.actions.filter((action) => selectedIds.includes(action.action_id)) ?? []

  async function connectGroq() {
    if (!groqKey.trim()) { setGroqError('Enter your Groq API key first.'); return }
    setBusy(true); setGroqError(''); setGroqConnected(false); setGroqModelCount(null)
    try {
      const result = await validateGroqKey(groqKey)
      setGroqConnected(result.connected)
      setGroqModelCount(result.model_count)
    } catch (caught) {
      setGroqError(caught instanceof Error ? caught.message : 'Groq could not verify this API key.')
    } finally { setBusy(false) }
  }

  async function handleUpload(file?: File) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) { setError('Only CSV files are supported.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('This file exceeds the 10 MB upload limit.'); return }
    setError(''); setBusy(true)
    try { const uploaded = await uploadCsv(file); setDataset(uploaded); setPlan(null); setSelectedIds([]); setPreview(null); setResult(null); setTab(groqAcknowledged && groqConnected ? 'chat' : 'overview') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The file could not be uploaded.') }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  async function makePlan(request = requestText) {
    if (!dataset) return
    setBusy(true); setError('')
    try { const next = await generatePlan(dataset.dataset_id, dataset.session_token, mode, request.trim(), groqKey); setPlan(next); setSelectedIds([]); setPreview(null); setTab('preprocessing'); setRequestText(request) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The cleaning plan could not be generated.') }
    finally { setBusy(false) }
  }
  async function buildPreview() {
    if (!dataset || !plan || !selectedIds.length) return
    setBusy(true); setError('')
    try { setPreview(await previewSelection(dataset.dataset_id, dataset.session_token, plan.plan_version, selectedIds)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The selected actions could not be previewed.') }
    finally { setBusy(false) }
  }
  async function confirmActions() {
    if (!dataset || !plan || !preview) return
    setConfirmOpen(false); setBusy(true); setError('')
    try { const exported = await applySelection(dataset.dataset_id, dataset.session_token, plan.plan_version, selectedIds); setResult(exported); setPreview(null); setTab('report') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The cleaned copy could not be created.') }
    finally { setBusy(false) }
  }
  async function downloadCsv() {
    if (!dataset || !result) return
    try { await downloadExport(dataset.session_token, result.export_id, result.filename) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The download could not be started.') }
  }
  async function resetCurrentWorkingCopy() {
    if (!dataset) return
    setBusy(true); setError('')
    try { await resetWorkingCopy(dataset.dataset_id, dataset.session_token); setPlan(null); setSelectedIds([]); setPreview(null); setResult(null); setTab('overview') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The working copy could not be reset.') }
    finally { setBusy(false) }
  }
  async function startOver() {
    if (dataset) { try { await clearDataset(dataset.dataset_id, dataset.session_token) } catch { /* an expired session is already gone */ } }
    setDataset(null); setPlan(null); setSelectedIds([]); setPreview(null); setResult(null); setGroqKey(''); setGroqConnected(false); setGroqModelCount(null); setGroqAcknowledged(false); setGroqError(''); setRequestText(''); setTab('overview'); setError('')
  }
  const activeTitle = tabs.find((item) => item.id === tab)?.label ?? 'Overview'

  return <div className="app-shell">
      <header className="topbar"><a className="brand" href="#top" onClick={(event) => { event.preventDefault(); if (dataset) void startOver() }} aria-label="DataTidy AI home"><span className="brand-mark"><Activity size={19} /></span><span className="brand-name">DATA<span>TIDY</span><sup>AI</sup></span></a><div className="topbar-center"><span className="live-dot" /> CSV ANALYTICS WORKSPACE</div><div className="topbar-right">{dataset ? <span className="file-chip"><FileSpreadsheet size={14} />{dataset.filename}</span> : <span className="privacy-chip"><LockKeyhole size={13} />PRIVATE BY DEFAULT</span>}{groqConnected && <span className="groq-connected-chip"><CheckCircle2 size={13} /> GROQ CONNECTED</span>}<span className="top-status"><span className="status-dot" /> SYSTEM ONLINE</span></div></header>
    <main id="top" className="workspace">
      <div className="page-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> DATA HYGIENE / SESSION 01</div><h1>{dataset ? <>{activeTitle}<span className="heading-period">.</span></> : <>Your data has a signal.<br /><span>Let’s find it.</span></>}</h1><p className="intro-copy">{dataset ? 'Explore actual rows, review quality signals, and approve every change to your working copy.' : 'Upload a real CSV to profile, explore, clean, and chat with your data.'}</p></div></div>
      {dataset && <nav className="workspace-tabs" aria-label="Dataset workspace sections">{tabs.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" className={tab === item.id ? 'selected' : ''} onClick={() => { setTab(item.id); setError('') }} aria-current={tab === item.id ? 'page' : undefined}><Icon size={15} />{item.label}{item.id === 'report' && result && <span className="tab-indicator" />}</button> })}</nav>}
      {error && <div className="alert alert-error" role="alert"><AlertTriangle size={16} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {!dataset && <>
        <section className="start-grid"><section className={`upload-panel ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void handleUpload(event.dataTransfer.files[0]) }}><div className="upload-emblem"><CloudUpload size={25} /></div><div className="upload-kicker">DROP ZONE / CSV INPUT</div><h2>Bring in your CSV</h2><p className="upload-description">Drag a file here or select one from your device.<br />The original upload stays unchanged.</p><button id="csv-upload-button" className="button button-primary" type="button" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? <RefreshCw className="spin" size={15} /> : <FileSpreadsheet size={16} />}{busy ? 'Reading dataset…' : 'Choose CSV file'}<ArrowRight size={15} /></button><input ref={fileRef} type="file" accept=".csv,text/csv" hidden aria-label="Choose a CSV file" onChange={(event) => void handleUpload(event.target.files?.[0])} /><div className="limits-row"><span>CSV ONLY</span><i /><span>MAX 10 MB</span><i /><span>50K ROWS</span><i /><span>100 COLUMNS</span></div></section>
          <aside className="key-panel"><div className="key-heading"><span className="key-icon"><KeyRound size={17} /></span><span className="eyebrow small"><span className="eyebrow-line" /> OPTIONAL SETUP</span></div><h2>Connect Groq AI</h2><p className="key-copy">Enter your key for AI cleaning suggestions and grounded dataset chat. Profiling and charts also work without one.</p><label className="field-label" htmlFor="groq-key">GROQ API KEY</label><div className="key-input-wrap"><input id="groq-key" className="key-input" type={keyVisible ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="gsk_••••••••••••••••" value={groqKey} onChange={(event) => { setGroqKey(event.target.value); setGroqConnected(false); setGroqModelCount(null); setGroqAcknowledged(false); setGroqError('') }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void connectGroq() } }} /><button type="button" className="key-visibility" onClick={() => setKeyVisible((shown) => !shown)} aria-label={keyVisible ? 'Hide Groq API key' : 'Show Groq API key'}>{keyVisible ? <EyeOff size={15} /> : <Eye size={15} />}</button></div><div className="key-help"><LockKeyhole size={13} /><span>Held in this page’s memory; it is never saved by DataTidy. Sent only to verify and for your Groq requests.</span></div>{groqError && <div className="key-error" role="alert">{groqError}</div>}{!groqAcknowledged ? <div className="key-actions"><button className="button button-primary key-connect-button" type="button" onClick={() => void connectGroq()} disabled={busy || !groqKey.trim()}>{busy ? <><RefreshCw className="spin" size={14} /> Checking Groq…</> : groqConnected ? <><CheckCircle2 size={15} /> Connected</> : <>Connect Groq <ArrowRight size={14} /></>}</button>{groqConnected && <button className="button button-quiet key-ok-button" type="button" onClick={() => { setGroqAcknowledged(true); requestAnimationFrame(() => document.getElementById('csv-upload-button')?.focus()) }}><Check size={14} /> Okay, continue</button>}</div> : <div className="key-status connected" role="status"><CheckCircle2 size={14} /> GROQ CONNECTED{groqModelCount !== null && <span> · {groqModelCount} MODELS AVAILABLE</span>}</div>}{groqConnected && !groqAcknowledged && <div className="key-status connected" role="status"><CheckCircle2 size={14} /> GROQ KEY VERIFIED{groqModelCount !== null && <span> · {groqModelCount} MODELS AVAILABLE</span>}</div>}</aside></section>
        <div className="under-upload"><button type="button" className="sample-link" onClick={() => void handleUpload(new File([sampleCsv], 'customer_sample.csv', { type: 'text/csv' }))} disabled={busy}><FlaskConical size={15} /> Try a sample dataset <ArrowRight size={13} /></button><div className="privacy-note"><LockKeyhole size={14} /><span><strong>Temporary session.</strong> Uploads expire after 30 minutes or when you clear the workspace.</span></div></div>
        <section className="feature-strip"><Feature index="01" title="Inspect" text="Profile actual rows and quality signals." icon={<ScanSearch size={17} />} /><span className="feature-arrow"><ArrowRight size={15} /></span><Feature index="02" title="Explore" text="Use charts, preview, and data chat." icon={<MessageSquareText size={17} />} /><span className="feature-arrow"><ArrowRight size={15} /></span><Feature index="03" title="Review" text="Preview every approved change." icon={<ShieldCheck size={17} />} /></section>
      </>}
      {dataset && tab === 'overview' && <Overview dataset={dataset} mode={mode} setMode={setMode} request={requestText} setRequest={setRequestText} onPlan={() => void makePlan()} onClear={() => void startOver()} busy={busy} />}
      {dataset && tab === 'preview' && <DataPreview dataset={dataset} hasCleaned={Boolean(result)} />}
      {dataset && tab === 'eda' && <EdaWorkspace dataset={dataset} hasCleaned={Boolean(result)} />}
      {dataset && tab === 'chat' && <DatasetChat dataset={dataset} hasCleaned={Boolean(result)} apiKey={groqKey} />}
      {dataset && tab === 'preprocessing' && <>
        {!plan && <section className="workspace-panel preprocessing-start"><div className="eyebrow small"><span className="eyebrow-line" /> APPROVAL REQUIRED / NO CHANGES APPLIED</div><h2>Build a reviewable cleaning plan</h2><p>Groq can use profile signals and your request to suggest supported operations. Python validates the plan and executes only actions you approve.</p><button className="button button-primary" type="button" onClick={() => void makePlan()} disabled={busy}>{busy ? 'Preparing…' : mode === 'groq' ? 'Generate plan with Groq' : 'Generate rules-based plan'}<ArrowRight size={14} /></button></section>}
        {plan && !preview && <PlanReview plan={plan} selectedIds={selectedIds} onToggle={(action) => setSelectedIds((ids) => ids.includes(action.action_id) ? ids.filter((id) => id !== action.action_id) : [...ids, action.action_id])} onPreview={() => void buildPreview()} onRequest={(text) => void makePlan(text)} onReset={() => { setPlan(null); setSelectedIds([]) }} busy={busy} />}
        {plan && preview && <PreviewReview preview={preview} selectedActions={selectedActions} onBack={() => setPreview(null)} onConfirm={() => setConfirmOpen(true)} busy={busy} />}
      </>}
      {dataset && tab === 'report' && <>{result && <ExportReady result={result} onDownload={() => void downloadCsv()} onClear={() => void startOver()} />}<ReportWorkspace dataset={dataset} onDownloadCsv={result ? () => void downloadCsv() : undefined} onReset={result ? () => void resetCurrentWorkingCopy() : undefined} /></>}
      {confirmOpen && preview && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmOpen(false) }}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><button className="modal-close" type="button" aria-label="Close confirmation" onClick={() => setConfirmOpen(false)}>×</button><div className="modal-icon"><ShieldCheck size={21} /></div><div className="eyebrow">FINAL REVIEW / HUMAN APPROVAL</div><h2 id="confirm-title">Apply approved operations?</h2><p>This creates a separate working copy. Your original upload remains unchanged. You selected <strong>{selectedIds.length} {selectedIds.length === 1 ? 'operation' : 'operations'}</strong>.</p>{preview.summary.duplicate_rows_removed > 0 && <div className="row-loss-note"><AlertTriangle size={15} />{preview.summary.duplicate_rows_removed} exact duplicate rows will be removed.</div>}<div className="modal-actions"><button className="button button-quiet" onClick={() => setConfirmOpen(false)}>Return to preview</button><button className="button button-primary" onClick={() => void confirmActions()} disabled={busy}>{busy ? 'Applying…' : 'Confirm & apply'}<Check size={14} /></button></div></section></div>}
      <footer className="page-footer"><span>DATATIDY AI <span className="footer-version">/ MVP 0.2</span></span><span>BUILT FOR HUMAN REVIEW <i /> TEMPORARY SESSION</span></footer>
    </main>
  </div>
}

function Feature({ index, title, text, icon }: { index: string; title: string; text: string; icon: React.ReactNode }) { return <div className="feature-item"><div className="feature-icon">{icon}</div><div><div className="feature-number">STEP {index}</div><h3>{title}</h3><p>{text}</p></div></div> }
function Metric({ label, value, note, icon, tone = '' }: { label: string; value: string; note: string; icon?: React.ReactNode; tone?: string }) { return <div className={`metric-card ${tone}`}><div className="metric-top"><span>{label}</span>{icon && <span className="metric-icon">{icon}</span>}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div> }

function Overview({ dataset, mode, setMode, request, setRequest, onPlan, onClear, busy }: { dataset: Dataset; mode: 'groq' | 'rules'; setMode: (mode: 'groq' | 'rules') => void; request: string; setRequest: (value: string) => void; onPlan: () => void; onClear: () => void; busy: boolean }) {
  const [profile, setProfile] = useState(dataset.profile)
  useEffect(() => {
    let active = true
    void getActiveProfile(dataset.dataset_id, dataset.session_token).then((next) => { if (active) setProfile(next) }).catch(() => undefined)
    return () => { active = false }
  }, [dataset.dataset_id, dataset.session_token])
  return <>
    <section className="dataset-banner"><div className="dataset-file-icon"><FileSpreadsheet size={19} /></div><div className="dataset-name"><span className="micro-label">ACTIVE DATASET</span><strong>{dataset.filename}</strong></div><div className="dataset-meta">{bytesLabel(dataset.size_bytes)} <i /> UTF-8 CSV</div><div className="expires"><span className="status-dot" /> SESSION EXPIRES IN 30 MIN</div></section>
    <section className="metrics-grid"><Metric label="ROWS" value={profile.rows.toLocaleString()} note="records detected" icon={<Activity size={16} />} /><Metric label="COLUMNS" value={profile.columns_count.toString()} note="fields detected" icon={<FileSpreadsheet size={16} />} /><Metric label="COMPLETENESS" value={`${profile.completeness_score ?? 0}%`} note={profile.completeness_calculation ?? 'non-missing cells'} /><Metric label="QUALITY SIGNALS" value={(profile.quality_issues?.length ?? 0).toString()} note="confirmed + review candidates" tone={profile.quality_issues?.length ? 'amber' : ''} /></section>
    <section className="panel profile-panel"><div className="panel-heading"><div><div className="eyebrow small"><span className="eyebrow-line" /> DATA PROFILE / DETERMINISTIC</div><h2>Column signals</h2></div><span className="profile-count">{profile.columns_count} FIELDS</span></div><div className="table-wrap"><table className="profile-table"><thead><tr><th>FIELD NAME</th><th>TYPE</th><th>MISSING</th><th>UNIQUE</th><th>DETECTED SIGNALS</th></tr></thead><tbody>{profile.columns.map((column) => { const signals = [column.whitespace_count > 0 && `${column.whitespace_count} spaces`, column.outlier_count > 0 && `${column.outlier_count} possible outliers`, column.date_parse_rate >= .7 && `${Math.round(column.date_parse_rate * 100)}% dates`, column.case_variant_count > 0 && 'case variants'].filter(Boolean) as string[]; return <tr key={column.column_id}><td><span className="field-dot" />{column.name}</td><td><span className={`type-pill ${column.type}`}>{column.type}</span></td><td><strong>{column.missing_count}</strong><span className="muted-small"> / {Math.round(column.missing_rate * 100)}%</span></td><td>{column.unique_count.toLocaleString()}</td><td>{signals.length ? <div className="signal-list">{signals.map((signal) => <span className="signal-tag" key={signal}>{signal}</span>)}</div> : <span className="muted-small">No signal flagged</span>}</td></tr> })}</tbody></table></div><div className="panel-footnote"><Sparkles size={14} /> Quality checks are descriptive. Unusual values are review signals, not confirmed errors.</div></section>
    {profile.quality_issues && profile.quality_issues.length > 0 && <section className="overview-issues"><div className="plan-intro"><div><div className="eyebrow small"><span className="eyebrow-line" /> QUALITY REPORT</div><h2>Signals to review</h2></div><span className="plan-counter">{profile.quality_issues.length.toString().padStart(2, '0')} <small>ISSUES</small></span></div><div className="quality-issue-grid">{profile.quality_issues.slice(0, 8).map((issue, index) => <article className="quality-issue" key={`${issue.issue_type}-${index}`}><span className={`risk-pill ${issue.severity === 'review' || issue.severity === 'high' ? 'review' : issue.severity === 'medium' ? 'medium' : ''}`}>{issue.severity}</span><h3>{issue.issue_type.replace(/_/g, ' ')}</h3><p>{issue.columns.join(', ') || 'Dataset rows'} · {issue.count.toLocaleString()} instances</p><small>{issue.recommendation}</small></article>)}</div></section>}
    <section className="chat-panel request-panel"><div className="chat-top"><div className="chat-avatar"><MessageSquareText size={16} /></div><div><div className="eyebrow small"><span className="eyebrow-line" /> PREPROCESSING / HUMAN APPROVAL</div><h2>What should be performed?</h2></div><span className="chat-mode">{mode === 'groq' ? 'GROQ AI' : 'RULES ONLY'}</span></div><form className="chat-form" onSubmit={(event) => { event.preventDefault(); onPlan() }}><label className="sr-only" htmlFor="cleaning-request">Describe the operations you want</label><textarea id="cleaning-request" value={request} onChange={(event) => setRequest(event.target.value)} rows={3} maxLength={1000} placeholder="Example: Fill missing spend values with the median and trim whitespace from names." /><div className="chat-form-foot"><span>The assistant proposes supported operations. You review each action, preview changes, and approve before they are applied.</span><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Preparing plan…' : 'Get cleaning plan'}<ArrowRight size={14} /></button></div></form></section>
    <section className="profile-actions"><div className="planner-choice"><span className="micro-label">PLANNING ENGINE</span><div className="segmented"><button type="button" className={mode === 'groq' ? 'selected' : ''} onClick={() => setMode('groq')}><Sparkles size={14} /> Groq AI</button><button type="button" className={mode === 'rules' ? 'selected' : ''} onClick={() => setMode('rules')}><FlaskConical size={14} /> Rules only</button></div><p>{mode === 'groq' ? 'Only schema and aggregate quality signals go to Groq. Raw rows stay local.' : 'No profile data is sent to an AI provider.'}</p></div><div className="profile-buttons"><button className="button button-quiet" type="button" onClick={onClear}><Trash2 size={15} /> Clear data</button></div></section>
  </>
}

function PlanReview({ plan, selectedIds, onToggle, onPreview, onRequest, onReset, busy }: { plan: CleaningPlan; selectedIds: string[]; onToggle: (action: Action) => void; onPreview: () => void; onRequest: (request: string) => void; onReset: () => void; busy: boolean }) {
  const [draft, setDraft] = useState('')
  return <><div className="context-bar"><div className="context-label"><span className={`source-indicator ${plan.source}`} />{plan.source === 'groq' ? 'GROQ AI PLAN' : 'RULE-BASED PLAN'}<i /> VERSION {String(plan.plan_version).padStart(2, '0')}</div><p>{plan.notice}</p></div>
    <section className="chat-panel plan-chat"><div className="chat-top"><div className="chat-avatar"><MessageSquareText size={16} /></div><div><div className="eyebrow small"><span className="eyebrow-line" /> HUMAN REVIEW / ACTION PROPOSALS</div><h2>Choose what should happen</h2></div><span className="chat-mode">NO CHANGE APPLIED</span></div><form className="chat-form" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) { onRequest(draft.trim()); setDraft('') } }}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={1000} placeholder="Ask for a different supported action, for example: parse the signup_date column." /><div className="chat-form-foot"><span>Groq gets aggregate profile data, not raw rows. Python validates every proposed operation.</span><button className="button button-primary" type="submit" disabled={busy || !draft.trim()}><Send size={14} /> Ask Groq</button></div></form></section>
    <div className="plan-intro"><div><div className="eyebrow small"><span className="eyebrow-line" /> ACTION REVIEW / APPROVAL GATE</div><h2>Proposed operations</h2><p>Continue with an action to include it in a preview. Nothing runs yet.</p></div><span className="plan-counter">{plan.actions.length.toString().padStart(2, '0')} <small>ACTIONS</small></span></div>
    {!plan.actions.length ? <div className="empty-panel"><CheckCircle2 size={22} /><h3>No supported issues detected</h3><p>That does not guarantee the dataset is error-free. Explore it in Data Preview, EDA, or Chat.</p></div> : <div className="action-list">{plan.actions.map((action, index) => { const selected = selectedIds.includes(action.action_id); return <article className={`action-card ${selected ? 'is-selected' : ''}`} key={action.action_id}><div className="action-icon"><Sparkles size={17} /></div><div><div className="action-title-row"><span className="action-index">{String(index + 1).padStart(2, '0')}</span><h3>{operationTitles[action.operation] ?? action.operation.replace(/_/g, ' ')}</h3><span className={`risk-pill ${action.risk}`}>{action.risk} RISK</span></div><div className="action-target">{action.column_name ?? 'DATASET'}{action.parameters.strategy ? ` · ${action.parameters.strategy}` : ''}</div><p className="action-reason">{action.reason}</p><div className="action-review-actions"><button type="button" className={`action-choice continue-choice ${selected ? 'chosen' : ''}`} onClick={() => onToggle(action)} aria-pressed={selected}>{selected ? <><Check size={14} /> Selected for preview</> : <>Continue with this action <ArrowRight size={14} /></>}</button><button type="button" className="action-choice alternate-choice" onClick={() => setDraft(`Suggest a different supported action instead of ${operationTitles[action.operation] ?? action.operation}${action.column_name ? ` for ${action.column_name}` : ''}.`)}><MessageSquareText size={14} /> Ask for something else</button></div></div></article> })}</div>}
    <div className="sticky-actions"><button className="button button-quiet" onClick={onReset}>Reset plan</button><span className="selected-count">{selectedIds.length} <span>SELECTED</span></span><button className="button button-primary" onClick={onPreview} disabled={!selectedIds.length || busy}>{busy ? 'Building preview…' : 'Preview selected changes'}<ArrowRight size={14} /></button></div>
  </>
}
function PreviewReview({ preview, selectedActions, onBack, onConfirm, busy }: { preview: PreviewResult; selectedActions: Action[]; onBack: () => void; onConfirm: () => void; busy: boolean }) {
  const summary = preview.summary
  return <><div className="preview-banner"><div className="preview-shield"><ShieldCheck size={17} /></div><div><strong>PREVIEW ONLY — ORIGINAL FILE HAS NOT CHANGED</strong><span>Calculated on a separate copy. Confirm only if the impact looks right.</span></div></div><section className="impact-grid"><Metric label="ROWS" value={`${summary.rows_before} → ${summary.rows_after}`} note="before → after" /><Metric label="CELLS CHANGED" value={summary.changed_cells.toLocaleString()} note={`${summary.affected_rows} rows affected`} /><Metric label="ROWS REMOVED" value={summary.duplicate_rows_removed.toString()} note="exact duplicates" tone={summary.duplicate_rows_removed ? 'amber' : ''} /><Metric label="DATE FAILURES" value={summary.date_parse_failures.toString()} note="left unchanged" /></section>{preview.warnings.map((warning) => <div className="alert" key={warning}><AlertTriangle size={15} />{warning}</div>)}<section className="panel diff-panel"><div className="panel-heading"><div><div className="eyebrow small"><span className="eyebrow-line" /> FIRST SIX ROWS</div><h2>Before & after</h2></div></div><div className="diff-columns"><SampleTable title="BEFORE" rows={preview.before_rows} /><SampleTable title="AFTER" rows={preview.after_rows} /></div></section><div className="applied-list"><div className="micro-label">SELECTED OPERATIONS</div>{selectedActions.map((action) => <div className="applied-item" key={action.action_id}><Check size={13} />{operationTitles[action.operation] ?? action.operation}{action.column_name && <code>{action.column_name}</code>}</div>)}</div><div className="sticky-actions"><button className="button button-quiet" onClick={onBack}>Back to actions</button><span className="confirmation-hint"><LockKeyhole size={13} /> Requires your approval</span><button className="button button-primary" onClick={onConfirm} disabled={busy}>Continue with approved actions <ArrowRight size={14} /></button></div></>
}
function SampleTable({ title, rows }: { title: string; rows: Record<string, unknown>[] }) { const columns = rows[0] ? Object.keys(rows[0]) : []; return <div><div className="diff-label">{title}<span>{rows.length} ROWS</span></div><div className="sample-table-wrap"><table className="sample-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{showCell(row[column])}</td>)}</tr>)}</tbody></table></div></div> }
function ExportReady({ result, onDownload, onClear }: { result: ExportResult; onDownload: () => void; onClear: () => void }) { return <section className="export-card"><div className="export-orbit"><div><FileCheck2 size={27} /></div></div><div className="eyebrow">TRANSFORMATION COMPLETE</div><h2>Your cleaned CSV<br /><span>is ready.</span></h2><p>A new working copy was created. Your original upload is still unchanged.</p><div className="export-file"><div className="dataset-file-icon"><FileSpreadsheet size={19} /></div><div><span className="micro-label">NEW FILE</span><strong>{result.filename}</strong></div><span className="ready-pill"><Check size={12} /> READY</span></div><div className="export-summary"><div><strong>{result.summary.rows_after.toLocaleString()}</strong><span>ROWS</span></div><div><strong>{result.summary.columns_after}</strong><span>COLUMNS</span></div><div><strong>{result.summary.changed_cells.toLocaleString()}</strong><span>CELLS CHANGED</span></div></div><div className="export-buttons"><button className="button button-primary" onClick={onDownload}><Download size={16} /> Download cleaned CSV</button><button className="button button-quiet" onClick={onClear}><RefreshCw size={15} /> Clear data & start over</button></div></section> }
