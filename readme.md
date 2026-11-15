# MarketPro: AI Marketing Assistant

## Overview

We are building an AI marketing assistant for small businesses. It learns each business once, then plans, writes and posts their social media through a simple chat. Three MVPs take it from a working pilot with our first customers to a paid product ready to grow.

**Target customers:** small businesses with no marketing staff (shops, restaurants, gyms, local services). Pilot companies are the launch audience.

### Guiding principles

- **One app, many companies:** a single multi-tenant web app; each company gets its own workspace.
- **Local AI first:** our own GPU servers handle most work; Claude is optional for complex tasks and premium plans.
- **Human approves:** nothing is published without the customer's approval.
- **Ship small, learn fast:** each MVP is tested with real customers before the next one starts.

|       | MVP 1           | MVP 2                   | MVP 3                |
| ----- | --------------- | ----------------------- | -------------------- |
| Theme | Core assistant  | Automation + hybrid AI  | Growth + premium     |
| Users | Pilot companies | Pilot companies, paying | 25+ paying companies |

## MVP 1: Core assistant

MVP 1 proves that a company can chat with the assistant and get a post written, approved and published on one platform.

**Goal:** each pilot company publishes at least 4 posts through the app.

### Features

- Web app with login and one workspace per company (shared database, `company_id` on every row, Row-Level Security).
- Business profile: name, products, brand voice, target audience.
- Chat assistant on our local AI model (served with vLLM or Ollama) that writes captions, hashtags and ad copy using the business profile.
- Connect Facebook and Instagram (via Meta Graph API or a unified posting API such as Ayrshare).
- Post composer: edit text, upload an image, preview.
- Approve, then publish now or schedule for later.
- Simple post list: draft, scheduled, posted.

**Out of scope:** analytics, AI images, other platforms, billing, Claude.

### Success criteria

- [ ] All pilot companies onboarded and connected to at least one account
- [ ] 28+ posts published through the app
- [ ] Customers rate the AI-written posts usable with light edits
- [ ] No cross-company data leaks in testing

## MVP 2: Automation and hybrid AI

MVP 2 turns the chat tool into a real assistant: it remembers the business, suggests posts on its own, and uses Claude when a task needs it. This is the version the 7 companies start paying for.

**Goal:** at least 5 pilot companies convert to a paid plan.

### Features

- **AI router:** sends short tasks to the local model and complex ones (monthly plans, long content) to Claude; per-company setting `local_only | hybrid | premium`; automatic fallback to Claude if local servers are down.
- **Memory (RAG):** retrieval (RAG) only when a customer's catalog or post history outgrows the prompt. Until then, the business profile goes into every prompt directly.
- **AI tools:** the assistant can create, schedule and list posts directly from the chat, with customer approval.
- **Proactive suggestions:** weekly background job drafts next week's posts; holiday and event reminders.
- **More platforms:** LinkedIn and X (or TikTok, depending on pilot demand).
- **Basic analytics:** likes, comments and reach per post, pulled daily.
- **Billing:** Stripe subscriptions with 2 plans (Basic local AI, Pro with Claude).
- **Usage tracking:** tokens and cost per company and per model.

### Success criteria

- [ ] 5+ pilot companies on a paid plan
- [ ] 70%+ of AI requests served by the local model
- [ ] Customers approve most weekly suggested posts
- [ ] AI cost per company stays under 20% of its subscription price

## MVP 3: Growth and premium

MVP 3 makes the product ready to sell beyond the pilot: self-serve sign-up, AI images, paid ads and team features.

**Goal:** grow to 25+ paying companies with self-serve onboarding.

### Features

- **Self-serve onboarding:** public sign-up, guided setup that builds the business profile in 5 minutes, free trial.
- **AI images:** product and promo images from a local image model (Stable Diffusion or Flux).
- **Monthly content calendar:** the assistant plans a full month in one request (Claude on Pro plan).
- **Analytics insights in plain language:** "Video posts get 3x more reach; do more of those."
- **Paid ads (beta):** create and boost ads through the Meta Marketing API, with budget limits.
- **Teams:** multiple users per company with roles (owner, editor, approver).
- **Comment and DM replies:** AI drafts replies for the customer to approve.
- **Agency mode / white-label:** one account manages several client workspaces with their own branding.
- **Industry templates:** ready-made post ideas for chosen niches (e.g., restaurants, retail).

### Success criteria

- [ ] 25+ paying companies
- [ ] Trial-to-paid conversion of 20%+
- [ ] Monthly churn under 5%
- [ ] Local GPUs handle peak load without slowdowns

## Architecture and tech stack

Every request flows from the chat through the orchestrator. Customer data stays in AWS. The GPU servers receive only the prompt for each task over a private link and return the result; they keep no customer records.

| Layer           | Choice                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Frontend        | React / Next.js web app, served by CloudFront                                                          |
| Backend         | Node.js (NestJS) or Python (FastAPI) on ECS Fargate behind an Application Load Balancer                |
| Database        | Amazon RDS for PostgreSQL (Multi-AZ) with Row-Level Security; pgvector only if retrieval is added later |
| File storage    | Amazon S3, private buckets with time-limited links                                                     |
| Job queue       | ElastiCache for Redis with BullMQ or Celery                                                            |
| Secrets and keys | AWS Secrets Manager and KMS                                                                           |
| Local AI        | Open-weight model (Llama, Qwen, Mistral) on vLLM or Ollama, on your GPU servers, reached over a Site-to-Site VPN |
| Cloud AI        | Claude API, optional, per company setting                                                              |
| Images (MVP 3)  | Stable Diffusion or Flux on local GPUs                                                                 |
| Social and mail | Meta Graph API, LinkedIn, X, Gmail API; or a unified posting API (Ayrshare)                            |
| Billing         | Stripe                                                                                                 |
| Monitoring      | Amazon CloudWatch, with personal data redacted from logs                                               |

## Data residency and hosting

Customer data stays in one AWS region, and the GPU servers hold no customer records.

### Rules

- Pick one region for the whole platform, for example `us-east-1` for US customers or `eu-central-1` for EU customers. The database, files and backups stay in that region.
- The GPU servers receive one task at a time over the private link, return the output, and keep no prompts or results beyond a short error log you control.
- The GPU servers have no public inbound ports. Only AWS can reach them, through a Site-to-Site VPN or Tailscale.
- Social and Gmail tokens are encrypted with KMS and never written to logs or sent to the GPU servers.
- Claude receives only the prompt for that task, and only for companies whose setting allows it. List it in your privacy policy as a third-party processor.

| Component        | AWS service                             | Notes                              |
| ---------------- | --------------------------------------- | ---------------------------------- |
| Web app and API  | ECS Fargate + Application Load Balancer | Scales with traffic                |
| Database         | RDS for PostgreSQL, Multi-AZ            | Encrypted, daily automated backups |
| Files and images | S3, private buckets                     | Signed links only                  |
| Queue and cache  | ElastiCache for Redis                   | Runs scheduled drafts and digests  |
| Secrets and keys | Secrets Manager and KMS                 | Token encryption keys              |
| Local AI link    | Site-to-Site VPN or Tailscale           | Private, outbound only             |
| Logs and metrics | CloudWatch                              | Redact emails and post text        |

## Database changes

Compared with the earlier design, `companies` gain a region and AI mode, `social_accounts` becomes a general `oauth_connections` table, and four tables are added for usage, digests, todos and audit logs.

| Table               | Purpose                                                  | Key columns                                                                  | Status                             |
| ------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------- |
| `companies`         | Workspace and settings                                   | id, name, brand_voice, region, ai_mode, plan                                 | Changed: region and ai_mode added  |
| `users`             | People in a company                                      | id, company_id, email, role                                                  | Unchanged                          |
| `oauth_connections` | Gmail, Outlook, Facebook, Instagram, LinkedIn, X accounts | id, company_id, provider, token_encrypted, expires_at                        | Replaces social_accounts           |
| `products`          | Catalog used in posts                                    | id, company_id, name, description, price, image_key                          | Changed: image stored as S3 key    |
| `chat_messages`     | Assistant conversation                                   | id, company_id, user_id, role, content, created_at                           | Unchanged                          |
| `posts`             | Drafts, scheduled and posted                             | id, company_id, platform, content, image_key, status, scheduled_at           | Changed: image_key added           |
| `post_analytics`    | Results per post                                         | id, post_id, likes, comments, reach, clicks, pulled_at                       | Unchanged                          |
| `ai_requests`       | Usage and cost per call                                  | id, company_id, model (local or claude), tokens_in, tokens_out, cost, created_at | New in MVP 2                   |
| `email_digests`     | Daily summaries from Gmail                               | id, company_id, user_id, digest_date, summary                                | New in MVP 2                       |
| `todos`             | Action items from digests                                | id, company_id, user_id, text, due_date, source, done                        | New in MVP 2                       |
| `audit_log`         | Who approved and published what                          | id, company_id, user_id, action, created_at                                  | New in MVP 1                       |

Every table carries `company_id`, and Row-Level Security filters each query by it. Email bodies are never stored, only the summary. Suggested retention: delete digests and todos after 90 days.

## Risks, costs and next steps

### Risks

| Risk                                       | Impact                 | Mitigation                                                      |
| ------------------------------------------ | ---------------------- | --------------------------------------------------------------- |
| Social platform API approval takes weeks   | Delays MVP 1 launch    | Start app review in week 1; use a unified posting API meanwhile |
| Local model quality too low for some tasks | Customers edit heavily | Route those tasks to Claude; test larger models                 |
| Cross-company data leak                    | Loss of trust          | Row-Level Security, tests per release                           |
| GPU servers overloaded at peak             | Slow responses         | Request queue, rate limits, Claude fallback                     |
| Expired social tokens                      | Posts fail silently    | Token refresh job and failure alerts                            |
| Customers don't see enough value to pay    | No revenue             | Weekly feedback calls during the pilot                          |

### Costs

Main running costs: GPU server power and maintenance, Claude API usage (Pro plan only), hosting and database, posting API fees if used, Stripe fees.

### Next steps

- [ ] Confirm which platforms the pilot companies use most
- [ ] Pick and benchmark a local model on our GPUs
- [ ] Register developer apps with Meta
- [ ] Set up the repo, database and hosting
- [ ] Book kickoff calls with pilot companies
