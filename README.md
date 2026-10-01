# SpecPage — OpenAPI & Swagger docs for Confluence Cloud

SpecPage is an [Atlassian Forge](https://developer.atlassian.com/platform/forge/) app. It adds a Confluence macro that renders interactive API documentation from OpenAPI 3.0 / 3.1 / 3.2 or Swagger 2.0 specs.

## Features

| Area | What it does |
|---|---|
| **Sources** | Page attachment, Git (GitHub, GitHub Enterprise Server, GitLab SaaS / self-managed, Bitbucket Cloud), https URL, or pasted text |
| **Multi-file specs** | Relative `$ref`s (`./schemas/pet.yaml`) are resolved from the same repository or page and bundled into one document |
| **Private repositories** | Admin-managed Git connections. Tokens are encrypted in Forge secret storage and never sent to the browser. Each connection has a repository allow-list and optional space restrictions |
| **Try it out** | Requests are relayed by the app backend, so browser CORS limits don't apply. Off by default; only admin-approved API hosts and only signed-in licensed users |
| **Filtering** | Show only selected tags or path prefixes, hide deprecated operations |
| **Display** | Expansion mode, max height, toggle info / servers / schemas / search box, custom title |
| **Multiple macros per page** | Each macro is independent |
| **Live preview** | The config dialog renders the spec as you edit. Paste a GitHub / GitLab / Bitbucket file link to fill in repo, branch and path |
| **Search** | API title, endpoints and summaries are added to Confluence search (indexed macro parameter) |
| **PDF / Word export** | Exports render a static endpoint table instead of an empty box |
| **Public spaces** | Guests and anonymous visitors can read docs (they can never use "Try it out") |
| **Theming** | Follows Confluence light / dark themes via Atlassian design tokens |
| **Performance** | Git / URL specs are cached (configurable TTL). Attachments are never cached because access depends on the reader's permissions |
| **Strict security** | No inline scripts or styles, no `eval`, no `unsafe-*` CSP entries, no static egress |

## Security model

- **No egress by default.** The manifest declares no external hosts. A Confluence admin approves each Git host, spec host and "Try it out" API host in SpecPage settings using Forge [customer-managed egress](https://developer.atlassian.com/platform/forge/customer-managed-egress-and-remotes/). Atlassian shows its own consent dialog, and approvals can be revoked in Atlassian Administration → Connected apps.
  - Trade-off: apps using customer-managed egress are **not eligible for the "Runs on Atlassian" badge**.
- **Authorization uses the trusted resolver context**, never browser-supplied values. Saved macro config, page ID and space key come from the Forge context.
  - Unsaved preview config is accepted only from licensed users.
  - Admin functions verify Confluence admin rights with the user's own permissions (`/wiki/rest/api/user/current?expand=operations`).
- **Attachments:** licensed users read them with their own permissions. Guests and anonymous visitors (who cannot make `asUser()` calls) are served only attachments of the page they are viewing.
- **Git:** repository allow-lists, path normalisation (no `..` escapes, spec extensions only), and parsing as OpenAPI before anything is returned. Together these stop the macro being used to read arbitrary repository files.
- **Try it out proxy:** strips cookies, hop-by-hop and `sec-*` headers, does not follow redirects, uses https only, and caps request (400 KB) and response (4 MB) sizes.

## Project layout

```
manifest.yml            Forge manifest (macro, admin settings page, functions)
src/index.ts            Resolver + adfExport handlers
src/backend/            Spec loading, sources, $ref bundling, cache, proxy, admin, export
src/shared/             Types and pure logic shared by backend and UI
static/app/             Custom UI (Vite + React + Swagger UI): macro, config, admin entries
test/                   Unit tests (Vitest) with mocked Forge APIs
e2e/                    Browser tests (Playwright) under a strict CSP with a mocked bridge
```

## Develop and verify

Requires Node 22+ (24 recommended).

```bash
npm install            # also installs static/app
npm run verify         # typecheck + lint + unit tests + UI build
npm run test:e2e       # browser tests (set PLAYWRIGHT_CHROMIUM_PATH if needed)
```

## Deploy to your Confluence site

1. Create a free developer site at https://developer.atlassian.com (Confluence Cloud).
2. Install the Forge CLI and log in:
   ```bash
   npm install -g @forge/cli
   forge login            # uses an Atlassian API token
   ```
3. Register the app. This replaces the placeholder `app.id` in `manifest.yml`:
   ```bash
   forge register
   ```
4. Build, lint, deploy and install:
   ```bash
   npm run build
   forge lint
   forge deploy
   forge install          # choose Confluence and your site
   ```
5. In Confluence, type `/OpenAPI` in the editor to insert the macro.
6. Open **Manage apps → SpecPage → Configure** to add Git connections and approve hosts.

After changing `manifest.yml` permissions, run `forge deploy` followed by `forge install --upgrade`.

## Limits

| Item | Limit |
|---|---|
| Spec size (including referenced files) | 4.5 MB (Forge invocation responses are capped at 5 MB) |
| Referenced files | 50 |
| Pasted specs | 100,000 characters |
| Approved hosts | 10 per list (Forge limit); wildcards such as `*.example.com` are supported |
| "Try it out" multipart / file uploads | Not supported |
| OAuth2 authorization flows in "Try it out" | Not supported; API keys and bearer tokens work |
| AsyncAPI | Not supported |
| Azure DevOps | Not supported yet |
