# Agent Scaffold

This repository is a scaffold for building durable AI agents using Next.js, Restate, and the Vercel AI SDK.

## Deployment

The project is configured to be deployed to Vercel and Restate Cloud via GitHub Actions.

### Required GitHub Secrets

To enable automatic deployment, you must configure the following secrets in your GitHub repository:

| Secret | Description |
| --- | --- |
| `VERCEL_TOKEN` | Your Vercel Personal Access Token. |
| `VERCEL_ORG_ID` | Your Vercel Organization ID. |
| `VERCEL_PROJECT_ID` | Your Vercel Project ID. |
| `RESTATE_ADMIN_URL` | Your Restate Cloud Admin URL (e.g., from Developers > Admin URL). |
| `RESTATE_AUTH_TOKEN` | Your Restate Cloud API Token (Admin role). |
| `VERCEL_PROTECTION_BYPASS_TOKEN` | A secret token used to bypass Vercel Deployment Protection (sent via `x-vercel-protection-bypass` header). |

### Workflow

The deployment workflow (`.github/workflows/deploy.yml`) performs the following steps:

1.  **Unit Tests**: Runs `pnpm test` on every push to any branch.
2.  **Vercel Deployment**: On pushes to `master`, it deploys the application to Vercel in production mode using the Vercel CLI (the official recommended approach for custom CI/CD).
3.  **Restate Registration**: On pushes to `master`, it registers the Vercel deployment URL with Restate Cloud using the official `@restatedev/restate` CLI. It uses the `VERCEL_PROTECTION_BYPASS_TOKEN` to allow Restate Cloud to access the deployment even if protection is enabled.

## Local Development

1.  Copy `.env.example` to `.env` and fill in the required variables.
2.  Install dependencies: `pnpm install`
3.  Start the development server: `pnpm dev`
