# DataTidy AI

DataTidy AI is a temporary-session CSV workspace for profiling, exploratory analysis, reviewable preprocessing, and natural-language questions. It uses a React + TypeScript + Vite frontend, FastAPI + pandas backend, and Recharts for data visualizations. The UI uses a high-contrast Brutalist style.

## What works

- Upload and validate actual UTF-8 CSV files (10 MB, 50,000 data rows, 100 columns maximum).
- Deterministic column profiling, missingness/completeness, duplicates, whitespace and case variants, date parsing, invalid email formats, numeric outlier candidates, and identifier/cardinality signals.
- Paginated, searchable, sortable data preview against the original or cleaned working copy.
- EDA charts for numeric distributions, top categories, monthly date counts, numeric correlations, and a sampled scatter plot.
- Groq-assisted bounded cleaning suggestions with a deterministic rules fallback. Only predefined operations are accepted.
- Human review for each operation, a before/after preview, and an explicit confirmation before applying to a separate working copy.
- Dataset chat for summaries, missing-value checks, category frequencies, numeric statistics, grouped aggregates, correlations, possible outliers, filtered records, date trends, quality signals, original-versus-cleaned comparisons, and records with missing values. Groq classifies requests into an allowlisted analysis; pandas computes the answer. Without a key, supported question patterns use a rules parser.
- Optional retrieval-augmented chat: session-scoped BM25 searches row blocks locally, reranks matching rows, and shows numbered evidence snippets. When enabled, the app sends at most five selected snippets plus calculated results to Groq for a grounded explanation. Exact calculations remain deterministic pandas operations.
- Original-versus-cleaned comparison, operation history, unresolved quality signals, cleaned CSV export, and downloadable JSON quality report.

The original uploaded DataFrame is never mutated. Uploads and exports live in process memory for up to 30 minutes. CSV cells are treated as data; the application never evaluates formulas or executes cell contents.

## Local setup

Requirements: Python 3.11+ and Node.js 20+.

### Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
$env:CORS_ORIGINS = "http://localhost:5173"
$env:GROQ_API_KEY = "your-groq-key" # optional server-side fallback
uvicorn app.main:app --reload --port 8000
```

### Frontend

Open another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. You can enter a Groq key in the upload screen; it stays in page memory and is sent for key verification and Groq requests. Chat intent classification sends the question, schema, and short history; enabling RAG also sends selected row evidence and computed results. A server-side `GROQ_API_KEY` is an optional fallback. Rules-based profiling, EDA, supported chat analyses, and cleaning suggestions do not require a key. The Vite development server proxies `/api` to port 8000.

Try the built-in sample, or upload `backend/sample_data/messy_sample.csv`.

## Tests and production build

Run backend tests:

```powershell
cd backend
python -m pytest -q
```

Build the frontend:

```powershell
cd frontend
npm ci
npm run build
```

## Environment variables

Copy `.env.example` as a reference. Never put a secret in a `VITE_*` variable.

- `GROQ_API_KEY`: optional server-side Groq key, used only if a request does not supply a browser-entered key.
- `GROQ_MODEL`: Groq chat completion model; defaults to `openai/gpt-oss-20b`.
- `CORS_ORIGINS`: comma-separated allowed origins for split frontend/backend deployments. Leave unset for the single-origin Docker deployment.
- `PORT`: listening port; defaults to 8000.
- `VITE_API_BASE_URL`: optional frontend API base URL when hosting frontend and backend separately.

## Docker deployment

The root Dockerfile builds the Vite app and serves it from FastAPI in one container:

```powershell
docker build -t datatidy-ai .
docker run --rm -p 8000:8000 -e GROQ_API_KEY="your-key" datatidy-ai
```

Open `http://localhost:8000`. For a free portfolio demo, follow [deploy/free-first.md](deploy/free-first.md). For AWS App Runner with ECR, see [deploy/aws-apprunner.md](deploy/aws-apprunner.md). Leave `GROQ_API_KEY` unset for a public demo and let users enter their own key. Keep one instance and one worker while sessions use in-memory storage. For separate hosting, set the frontend's `VITE_API_BASE_URL` at build time and set backend `CORS_ORIGINS` to the deployed frontend origin.

## API

- `GET /api/health`
- `POST /api/datasets`
- `GET /api/datasets/{id}/profile`
- `GET /api/datasets/{id}/preview?page=1&page_size=20&search=&version=original`
- `GET /api/datasets/{id}/eda?version=original`
- `POST /api/datasets/{id}/plan`
- `POST /api/datasets/{id}/preview` (preview selected cleaning actions)
- `POST /api/datasets/{id}/apply` (requires a previous preview and `confirm: true`)
- `POST /api/datasets/{id}/chat`
- `GET /api/datasets/{id}/report`
- `GET /api/datasets/{id}/report/download`
- `GET /api/exports/{id}`
- `DELETE /api/datasets/{id}`

All dataset routes require the upload response's `X-Session-Token`. The API accepts only server-generated opaque dataset IDs, not client filesystem paths. Interactive API documentation is available at `/docs`.

## Privacy, deployment, and limits

- Cleaning suggestions send aggregate profile information, not CSV rows. Chat classification sends the question, recent short conversation context, and column names/types to Groq when a key is connected.
- Row snippets are retrieved locally and remain local unless the user enables RAG. With RAG enabled, up to five matching snippets and the computed pandas result are sent to Groq for the explanation; the full CSV is never sent as a file.
- Browser-entered Groq keys are held in page memory, sent over HTTPS in `X-Groq-API-Key`, and not stored or logged by the app. For production, use HTTPS and avoid shared/public devices.
- This MVP has no accounts, database, durable file history, or cross-instance session store. A server restart clears active uploads. Add shared ephemeral storage such as Redis before scaling horizontally.
- The chat parser supports a bounded set of analytical questions. Ambiguous or unsupported requests return a clear message. It does not run arbitrary code, SQL, or shell commands.
- RAG uses lexical BM25 retrieval, not semantic embedding search. It is local, temporary, and bounded to selected row snippets. Numeric aggregates and charts are calculated over the selected dataset version by pandas.
- EDA charts are intentionally bounded: category charts show common values, scatter plots sample at most 500 pairs, and the app caps uploads by size/row/column limits.
- Completeness is the share of non-missing cells, not a correctness score. IQR outliers and category inconsistencies are review candidates, not confirmed errors.

## Free-first cloud deployment

For a free-tier portfolio demo, use one Render Free Docker web service. Expect idle spin-down, a cold start, 512 MB RAM, 0.1 CPU, and session loss when the in-memory service restarts. Keep one instance and one worker. See [deploy/free-first.md](deploy/free-first.md) for setup and a cost-aware AWS alternative. To host the frontend on Vercel and the API on Render, follow [deploy/render-vercel.md](deploy/render-vercel.md). Render describes its free instances as suitable for testing and hobby projects, not production.
