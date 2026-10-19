# DataTidy AI

DataTidy AI is a CSV analysis and cleaning workspace. Upload a dataset to inspect its quality, explore patterns, ask supported questions in natural language, and review cleaning actions before they are applied.

**Live demo:** [Open DataTidy AI](https://datatidy-ai.vercel.app) · **API health:** [Check service status](https://datatidy-api.onrender.com/api/health)

## Features

- **Data quality profiling:** find missing values, duplicates, format inconsistencies, and potential outliers.
- **Preview and EDA:** search and inspect rows, then explore distributions, categories, date trends, correlations, and sampled relationships.
- **Guided cleaning:** receive suggested operations, inspect a before-and-after preview, and approve changes individually.
- **Chat with data:** ask supported questions about summaries, statistics, groups, trends, missing data, and quality signals.
- **Optional Groq and RAG:** Groq can interpret questions and explain results. Optional local BM25 retrieval finds relevant row snippets for grounded answers.
- **Exports:** download the cleaned CSV and a data quality report.

## How it works

Python and pandas compute profiles, charts, and analytical results. The assistant can propose or interpret an action, but the backend validates the request against supported operations. Changes are applied only after explicit user approval, to a working copy. The original upload remains unchanged, and the app does not execute CSV contents or arbitrary generated code.

## Tech stack

- **Frontend:** React, TypeScript, Vite, Recharts
- **Backend:** Python, FastAPI, pandas
- **AI:** Groq API (optional); deterministic rules-based fallbacks
- **Retrieval:** session-scoped BM25 over local row blocks

## Run locally

Requirements: Python 3.11+ and Node.js 20+.

Start the API in one terminal:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
$env:CORS_ORIGINS = "http://localhost:5173"
uvicorn app.main:app --reload --port 8000
```

Start the frontend in another terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), then upload a CSV or use the sample dataset. The API's interactive documentation is available at [http://localhost:8000/docs](http://localhost:8000/docs).

## Configuration

You can enter a Groq API key in the app. It is kept in page memory for the session. A server-side key is optional:

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Optional server-side Groq key; keep it on the backend and never expose it as a `VITE_*` variable. |
| `GROQ_MODEL` | Groq chat model. Defaults to `openai/gpt-oss-20b`. |
| `CORS_ORIGINS` | Comma-separated frontend origins allowed by the API. |
| `PORT` | API listening port. Defaults to `8000`. |
| `VITE_API_BASE_URL` | API base URL for a separately hosted frontend. Leave unset for local development with the Vite proxy. |

See [.env.example](.env.example) for the backend environment template.

## Verification

Run the backend test suite:

```powershell
cd backend
python -m pytest -q
```

Build the frontend for production:

```powershell
cd frontend
npm ci
npm run build
```

## Privacy and session limits

- Uploaded datasets are held in server memory for up to 30 minutes of inactivity. A restart or instance change clears the session; there is no account system or persistent file history.
- Groq requests use the question and limited dataset context needed for the selected task. When RAG is enabled, up to five retrieved row snippets and computed results may be sent for an answer. The full CSV is not uploaded to Groq.
- Use HTTPS when entering a Groq key. The app does not store or log browser-entered keys.
- RAG uses lexical BM25 retrieval rather than semantic embeddings. Chat supports bounded analyses and does not execute arbitrary code, SQL, or shell commands.
- Uploads are limited by file size, row count, and column count. Potential outliers and inconsistencies are review signals, not automatic diagnoses.

## Deployment

The live demo runs on free-tier hosting. The API may sleep while idle, and temporary in-memory sessions can be cleared when it restarts.

For an alternative single-container AWS deployment, see [the AWS App Runner guide](deploy/aws-apprunner.md).
