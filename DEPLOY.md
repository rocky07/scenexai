# Deploying Scenex AI

- **Client** (React) to AWS Amplify Hosting.
- **Server** (Node API) to an EC2 instance, behind nginx with HTTPS.

```
Browser ──> Amplify  https://main.<app-id>.amplifyapp.com   (static client)
   │
   └─────> EC2       https://api.yourdomain.com/api          (nginx ─> Node on :4000)
```

## 0. Before you start

- Push this project to its own GitHub repository (the `marketpro` folder is inside a larger git repo, so Amplify needs a repo of its own). Keep `.env` and `server/data/` out of git; `.gitignore` already does this.
- Own a domain (or subdomain) for the API, e.g. `api.yourdomain.com`, so HTTPS can be set up with Let's Encrypt.
- **Don't share your SSH password in chat.** Log in with an SSH key pair (`ssh -i key.pem rakesh@<public-ip>`). If you only have a password, set up a key first (`ssh-copy-id`) and rotate the password.

## 1. EC2 instance

1. Launch an instance: **Amazon Linux 2023**, **t3.micro** or **t4g.micro**, 8 GB disk. Create or pick a key pair.
2. Security group inbound rules:
   | Port | Source        | Why                          |
   | ---- | ------------- | ---------------------------- |
   | 22   | My IP only    | SSH                          |
   | 80   | 0.0.0.0/0     | HTTP (Let's Encrypt, redirect) |
   | 443  | 0.0.0.0/0     | HTTPS API                    |
   Port 4000 stays closed; only nginx talks to Node.
3. Create the user `rakesh` if it doesn't exist (`sudo adduser rakesh`, then add it to `wheel`: `sudo usermod -aG wheel rakesh`), or use the default `ec2-user`. Adjust the paths in `deploy/scenex-api.service` if you use a different user.
4. Point DNS: an `A` record for `api.yourdomain.com` to the instance's Elastic IP (allocate one so the address doesn't change on restart).

## 2. Set up the server

SSH in, then run:

```bash
REPO_URL=https://github.com/<you>/<repo>.git API_DOMAIN=api.yourdomain.com \
  bash <(curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/ec2-setup.sh)
```

Or clone the repo first and run `REPO_URL=... API_DOMAIN=... bash deploy/ec2-setup.sh`. The script installs nginx and Node, installs API dependencies, and installs the systemd service and nginx site.

Create the secrets file (never commit it):

```bash
cd ~/scenex-ai/server
cp .env.example .env
nano .env          # set SEED_PASSWORD, CORS_ORIGIN (after step 3), ANTHROPIC_API_KEY
chmod 600 .env
```

Start the API:

```bash
sudo systemctl start scenex-api
sudo systemctl status scenex-api      # should say "active (running)"
journalctl -u scenex-api -n 20        # shows the seeded login line on first start
curl -s localhost:4000/api/providers  # 401 is expected without a token; any JSON reply means it's up
```

Turn on HTTPS (after DNS points at the instance):

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
curl -s https://api.yourdomain.com/api/providers   # expect 401 JSON
```

Certbot renews the certificate automatically.

## 3. Deploy the client on Amplify

1. Amplify console → **Create new app** → **Host web app** → connect GitHub and choose the repo and branch `main`.
2. If the repo root is the project root, leave the app root as is. If the client sits in a `client/` folder, set **Monorepo app root** to `client`.
3. Build settings: Amplify reads `client/amplify.yml`. Confirm the build output directory is `dist`.
4. **Environment variables** (before the first build):
   - `VITE_API_URL` = `https://api.yourdomain.com/api`
5. Save and deploy. Amplify gives you a URL like `https://main.d1a2b3c4.amplifyapp.com`.
6. **Rewrites and redirects** (for future client routes; harmless now): add a rule
   - Source: `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/>`
   - Target: `/index.html`, Type: `200 (Rewrite)`

## 4. Connect the two

Put the Amplify URL into the server's CORS setting, then restart:

```bash
nano ~/scenex-ai/server/.env       # CORS_ORIGIN=https://main.d1a2b3c4.amplifyapp.com
sudo systemctl restart scenex-api
```

Open the Amplify URL and log in with `demo@scenex.local` and your `SEED_PASSWORD`. Change the password once you're in.

## 5. Updating later

- **Client:** push to `main`. Amplify rebuilds automatically.
- **Server:**
  ```bash
  cd ~/scenex-ai && git pull && cd server && npm ci --omit=dev
  sudo systemctl restart scenex-api
  ```

## Things to know

- **Data:** the database is a JSON file at `server/data/db.json`. Back it up (e.g. `cp` to S3 nightly). Move to Amazon RDS for PostgreSQL before real customers rely on it.
- **Local AI:** the EC2 instance has no GPU, so **Local AI** will show as offline unless `LOCAL_AI_URL` points at your model server, reachable over VPN or Tailscale. Claude works as long as `ANTHROPIC_API_KEY` is set.
- **Logs:** `journalctl -u scenex-api -f`.
- **Sessions:** logins are kept in `sessionStorage` per tab and tokens last 7 days.

## Local AI server (private IP)

The local model runs on your own server at a private IP, for example `10.0.1.25`. The API reaches it at:

```
LOCAL_AI_URL=http://10.0.1.25:13000/api/ask
LOCAL_AI_MODEL=qwen2.5:3b
```

The server must accept `POST /api/ask` with a JSON body `{ "prompt": "...", "model": "..." }` and reply `{ "response": "..." }`. Nothing else should reach it.

**Network**
- The GPU server must be able to reach the API's private network. Put it in the same VPC, peer the VPCs, or connect them with a Site-to-Site VPN or Tailscale.
- Its security group (or firewall) should allow inbound TCP `13000` **only from the API instance's security group or private IP**. Don't open it to `0.0.0.0/0`.
- It gets no public IP and no inbound SSH from the internet.

**Model server**
Run the server that exposes `POST /api/ask` on port `13000` and listens on the private interface only (not `0.0.0.0` on a public address). Keep the firewall rule above in place, because the server has no login.

If you switch to Ollama instead, set `LOCAL_AI_URL=http://10.0.1.25:11434` (no path). The app then uses Ollama's `/api/chat` route, and you can install it with `curl -fsSL https://ollama.com/install.sh | sh`.

**Check from the API instance**
```bash
curl -s -X POST http://10.0.1.25:13000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Reply with only the words: System online.","model":"qwen2.5:3b"}'
# expect: {"response":"System online."}
```
Then `sudo systemctl restart scenex-api`. In the app, the **Local AI** option turns green once the API can reach the GPU server.

**Note:** the app supports two local servers: the `/api/ask` prompt server above, and Ollama (base URL only). Any other API, such as vLLM's OpenAI-style endpoint, needs an adapter in `server/ai.js`.
