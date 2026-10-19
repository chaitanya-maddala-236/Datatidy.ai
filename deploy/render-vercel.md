# Deploy the frontend to Vercel and API to Render

This setup uses Vercel for the static React/Vite frontend and Render for the FastAPI API. The repository root contains both projects.

## 1. Deploy the API on Render

Create a Python web service from the repository with these settings:

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/api/health` |

After the first deploy, copy the service URL, for example `https://datatidy-api.onrender.com`.

## 2. Deploy the frontend on Vercel

Import the same repository as a Vercel project and configure:

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

In the Vercel project's environment variables, add `VITE_API_BASE_URL` with the Render service URL, without a trailing slash. Redeploy the frontend after adding or changing this variable; Vite embeds it into the frontend build.

## 3. Allow the frontend origin in Render

Copy the deployed Vercel origin, such as `https://datatidy-ai.vercel.app`, and add this Render environment variable:

```text
CORS_ORIGINS=https://datatidy-ai.vercel.app
```

Use only the origin (scheme and hostname), with no path or trailing slash. Add the custom domain as another comma-separated origin if one is configured. Save the variable and redeploy the API.

## 4. Check the deployment

Open `https://<render-service>.onrender.com/api/health`; it should return a healthy status. Then open the Vercel site, enter a Groq key in the app, upload the included sample CSV, and try Preview, EDA, and Chat with Data.

Do not add a user's Groq key to a `VITE_*` variable. Users can enter their own key in the app. Keep `GROQ_API_KEY` unset on a public demo unless you add authentication and per-user rate limits.

## Free-plan limitations

Render's free service can sleep when idle, has limited CPU and memory, and uses an ephemeral filesystem. This application keeps uploaded datasets in process memory, so sleeping or restarting the API can clear a dataset session; users may need to upload the CSV again. Treat the free deployment as a demo, and review current platform limits before relying on it for production.
