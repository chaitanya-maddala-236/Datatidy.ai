# Free-first deployment plan

## Recommended first host: Render Free

This is a hobby/demo deployment for the current one-container app. It serves the React build and FastAPI API from the same origin, so no separate frontend host, CORS setup, database, or paid domain is required.

### Deploy steps

1. Push this project to a GitHub repository. Keep `.env`, Groq keys, and uploaded CSVs out of Git.
2. In Render, create a **Web Service** from that repository and choose the **Docker** runtime. Keep the repository root as the service root so Render finds the root `Dockerfile`.
3. Choose the **Free** compute plan and a region near the people who will use the demo.
4. Set the health check path to `/api/health` and deploy. The Dockerfile listens on Render's `PORT` environment variable and serves both the API and frontend.
5. Leave `GROQ_API_KEY` unset so each user enters their own key in the app. Optionally set `GROQ_MODEL`; otherwise the application uses `openai/gpt-oss-20b`. Check Groq's current model catalog and your account's rate and billing limits before sharing the demo. Leave `CORS_ORIGINS` unset for this single-origin layout.
6. After deployment, open `/api/health`, upload the included sample CSV, check Preview and EDA, ask a supported data question, and optionally enable row retrieval after connecting Groq.

### Free-plan behavior and app limits

- Render's Free web service has 512 MB RAM and 0.1 CPU. It spins down after 15 minutes without incoming traffic and usually takes about a minute to wake.
- Render includes 750 Free instance hours per workspace each calendar month; spun-down time does not count. If the workspace uses all included hours, its free web services are suspended until the monthly reset. Keep an eye on the workspace's outbound bandwidth and build-pipeline usage too.
- Free services can restart at any time and have ephemeral filesystems. The current app stores uploads, the cleaned copy, BM25 indexes, and exports in process memory for up to 30 minutes of inactivity. A restart or sleep/wake can end those sessions, so users may need to upload again.
- Keep one service instance and the Dockerfile's single Uvicorn worker. The session store is process-local; multiple instances or workers would not share uploads.
- This is suitable for a portfolio demo or personal experimentation, not a production service. Free plan resource limits, sleep behavior, and restarts are documented by [Render](https://render.com/docs/free); its free web service has 512 MB and 0.1 CPU according to [Render compute plans](https://render.com/docs/compute-plans).
- Avoid keeping a shared Groq key in the service environment for a public demo. The app has no account system or per-user rate limits yet. Anyone who obtains a shared key could consume its quota.

## Keep build checks free

Use GitHub Actions to run the backend suite and frontend production build on each push. Standard hosted Actions runners are free for public repositories; private repositories have an included quota, which varies by plan. See [GitHub Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage).

## AWS when you need AWS services

The existing [App Runner guide](aws-apprunner.md) deploys the same Docker image through ECR. Treat this as a low-cost paid option rather than assuming it is always free: AWS App Runner bills provisioned memory while idle and CPU/memory during requests, and ECR, logs, and data transfer may add charges. At the published rate for some US/Europe regions, a 0.5 GB provisioned instance alone is about $2.56 for a 730-hour month before request compute and other services; check the current price for your region with the [AWS App Runner pricing page](https://aws.amazon.com/apprunner/pricing/).

New eligible AWS customers may receive promotional credits, but eligibility, available services, and expiration depend on the account. Do not treat credits as a permanent free tier; check the [AWS Free Tier terms and account credits](https://aws.amazon.com/free/free-tier-faqs/) and configure a billing budget before deploying.

## Upgrade path before public/production use

1. Add authentication, per-user request limits, upload quotas, and abuse protection.
2. Move session state out of process memory into a shared store; use private object storage with automatic deletion only if durable CSV handling is actually needed.
3. Add structured retention/deletion controls, observability without logging secrets or row contents, and a clear privacy notice for the optional row snippets sent to Groq.
4. Move to a paid host with enough memory for concurrent datasets, then test actual monthly usage with the provider's cost calculator and alerts.

The local BM25 retrieval index is intentionally in-memory and rebuilt per dataset version. It avoids a vector database bill in the demo. If semantic retrieval becomes a measured need, add embeddings and a persistent vector store as a later, separately budgeted change.
