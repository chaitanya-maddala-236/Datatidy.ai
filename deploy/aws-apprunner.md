# Deploy DataTidy AI to AWS App Runner

The app is packaged as one container: FastAPI serves both the API and the built React UI on port `8000`.

## 1. Build and push the image

Create a private Amazon ECR repository, then authenticate Docker to the registry using the commands shown by the ECR console. From this project directory, build the image for the Linux architecture used by App Runner and tag it with your ECR repository URI:

```powershell
docker build --platform linux/amd64 -t datatidy-ai .
docker tag datatidy-ai:latest <account-id>.dkr.ecr.<region>.amazonaws.com/datatidy-ai:latest
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/datatidy-ai:latest
```

## 2. Create the App Runner service

In AWS App Runner, create a service from the private ECR image. Choose the ECR access role, set the service port to `8000`, and add these runtime environment variables:

- `GROQ_API_KEY` — optional shared Groq key (secret value; enter it in AWS, not in the image or a `VITE_` frontend variable). Users can instead enter their own key in the app.
- `GROQ_MODEL` — optional; defaults to `openai/gpt-oss-20b`
- `CORS_ORIGINS` — leave unset when the UI and API use this same service origin

App Runner can serve a container image from ECR and manage the web service lifecycle. See [AWS App Runner image services](https://docs.aws.amazon.com/apprunner/latest/dg/service-source-image.html) and [creating an App Runner service](https://docs.aws.amazon.com/apprunner/latest/dg/manage-create.html).

User-entered keys are kept in the browser page's memory and sent to the app backend for Groq planning/chat requests. If the user explicitly enables RAG, selected row snippets and computed results are also sent to Groq for the answer. The backend does not persist or log the key. App Runner serves the app over HTTPS; keep that HTTPS endpoint for key entry.

## Notes for this MVP

- The session store is in process memory and expires uploads after 30 minutes of inactivity. Keep the service at one instance while using this storage design; a restart clears active sessions. Add shared ephemeral storage (such as Redis) before scaling to multiple instances.
- App Runner's container health check can call `GET /api/health`.
- Groq failures fall back to the deterministic rules planner, so uploading, profiling, previewing, and exporting still work without a configured key. The UI shows when a typed chat request could not be processed by Groq.
- Container logs do not include uploaded row data or the Groq key.
