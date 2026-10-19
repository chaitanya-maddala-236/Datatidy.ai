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

## Technologies

| Area | Technology | Role in the application |
| --- | --- | --- |
| User interface | React and TypeScript | Build the upload flow, data workspace, chat, review screens, and typed API interactions. |
| Frontend tooling | Vite | Run the local development server, proxy API requests during development, and bundle the production UI. |
| Charts and icons | Recharts and Lucide React | Render EDA visualizations and interface icons. |
| API | Python and FastAPI | Handle CSV uploads, session-scoped API requests, validation, and serving the application API. |
| Data processing | pandas | Compute profiles, EDA values, supported chat analyses, and approved cleaning operations deterministically. |
| AI assistance | Groq API (optional) | Classify supported chat questions and suggest cleaning plans when the user connects a key. |
| Retrieval | Custom, in-memory BM25 | Find relevant rows from local, session-scoped row blocks for optional grounded chat. No vector database or embedding service is required. |

## Application workflow

1. **Connect Groq (optional).** The user may enter and verify a Groq API key. Profiling, charts, and supported data analysis still work without one.
2. **Upload a CSV.** The API validates the file and creates a temporary dataset session. The dataset is held in server memory for that session.
3. **Profile and explore.** pandas computes data quality signals and EDA values. The React interface presents the profile, searchable preview, and Recharts visualizations.
4. **Ask questions.** With Groq connected, the model maps a question to a supported analysis. Without a key, a rules-based parser handles supported question patterns. pandas computes the answer in either case.
5. **Optionally retrieve evidence.** If the user enables RAG, the backend searches row blocks locally with BM25. It can send up to five matching snippets and the computed result to Groq to explain the answer. The full CSV is not sent to Groq.
6. **Review a cleaning plan.** Groq or the rules fallback proposes supported operations. The API validates the proposed actions and creates a before-and-after preview; it does not apply the changes yet.
7. **Approve and export.** The user chooses which actions to continue with and explicitly approves them. pandas applies approved actions to a separate working copy, leaving the original dataset unchanged. The user can download the cleaned CSV and quality report.

The AI proposes or interprets actions; deterministic Python code performs the calculations and cleaning. The application does not execute CSV contents or arbitrary generated code.

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
