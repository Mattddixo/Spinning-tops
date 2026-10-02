# SpecPage

A Confluence Cloud macro for OpenAPI / Swagger docs, built on Atlassian Forge.

Drop it on a page, point it at a spec, and you get Swagger UI inside Confluence. Supports OpenAPI 3.0, 3.1, 3.2 and Swagger 2.0.

## Where specs can come from

- A `.yaml` / `.json` file attached to the page
- A Git repo: GitHub (incl. Enterprise Server), GitLab (cloud or self-hosted), Bitbucket Cloud
- An https URL (admin has to turn this on)
- Pasted straight into the macro settings

If the spec is split into multiple files with relative `$ref`s, those get pulled in from the same repo/page and merged.

## Other stuff it does

- Filter by tag or path prefix, hide deprecated endpoints
- "Try it out" works. Requests go through the app backend instead of the browser, so no CORS errors. File uploads (multipart and raw binary) work, and images/PDFs come back as downloads. Off unless an admin enables it.
- Specs with relative server URLs (`/v1`) are resolved against the spec's URL when it has one. Otherwise, or if you want to point at staging, set a server URL in the macro settings.
- Preview while you edit the macro. You can paste a GitHub/GitLab/Bitbucket file link and it fills in repo, branch and path for you.
- Several macros on one page work fine
- Endpoints show up in Confluence search. If the spec changes after the macro was saved, editors get a note to re-save so search catches up.
- PDF/Word export prints a table of endpoints instead of a blank box
- Guests and anonymous users on public spaces can read the docs
- Follows Confluence light/dark theme
- Git and URL specs are cached (5 min to 24 h, set by the admin)
- English, German, French, Spanish and Japanese, following each user's Confluence language
- The settings page keeps an activity log: who changed settings, connections or approved hosts, and when (last 200 changes)

## Security notes

- The manifest doesn't allow any outside hosts. An admin approves each one (Git host, spec host, Try it out host) from the settings page. Atlassian shows its own confirmation for each, and they can be revoked under Atlassian Administration > Connected apps. The downside: apps that do this can't get the "Runs on Atlassian" badge.
- Git tokens go in Forge secret storage and never get sent to the browser. Each connection has a list of allowed repos and can be limited to certain spaces. File paths are checked (no `../`, spec files only) and the file has to parse as OpenAPI before anything is returned.
- Permission checks use the context Forge passes to the backend, not anything from the browser. Unsaved preview settings are only accepted from licensed users. The settings page checks the user is a Confluence admin.
- Licensed users read attachments as themselves. Guests/anonymous users can't, so the app reads for them, but only from the page they're already looking at.
- The Try it out proxy strips cookies and similar headers, doesn't follow redirects, and is https only. Request bodies are capped at 400 KB (350 KB for files), text responses at 4 MB and binary responses at 3 MB. Guests and anonymous users can't use it.
- The activity log stores field names only (for example "token" changed), never values.

## Layout

```
manifest.yml        Forge manifest
src/index.ts        resolver + export handler
src/backend/        loading specs, Git/attachment/URL sources, $ref bundling, cache, proxy, admin
src/shared/         types and logic used by both backend and UI
locales/            UI text, one JSON file per language (en-US is the source)
static/app/         the UI (Vite + React + Swagger UI): macro, config dialog, admin page
test/               unit tests (Vitest)
e2e/                browser tests (Playwright) with a fake Forge bridge and a strict CSP
```

## Running it locally

Node 22 or newer.

```bash
npm install          # installs static/app too
npm run verify       # typecheck, lint, unit tests, build
npm run test:e2e     # browser tests; set PLAYWRIGHT_CHROMIUM_PATH if Playwright can't find Chromium
```

## Deploying

1. Make a free Confluence dev site at https://developer.atlassian.com
2. Install the CLI and log in:
   ```bash
   npm install -g @forge/cli
   forge login
   ```
3. `forge register` (fills in the real `app.id` in manifest.yml)
4. Build and deploy:
   ```bash
   npm run build
   forge lint
   forge deploy
   forge install
   ```
5. In a Confluence page, type `/OpenAPI` to add the macro.
6. Git connections and approved hosts are under Manage apps > SpecPage > Configure.

If you change permissions in manifest.yml, run `forge install --upgrade` after deploying.

## Translations

`locales/en-US.json` is the source. The other files were translated without a native speaker check, so a review by one is worth doing before a big launch. `npm test` fails if a language file is missing a key, has an extra one, or drops a `{placeholder}`. To add a language, add the file and list it under `translations` in manifest.yml.

Swagger UI's own labels ("Try it out", "Execute", "Responses") stay in English; Swagger UI has no translation support. PDF/Word exports are also English for now.

## Limits / not supported yet

- Source files up to 20 MB in total, max 50 referenced files. The bundled spec is sent gzip'd and has to fit in 4.5 MB after compression (Forge caps responses at 5 MB). Most specs compress about 10x.
- Loading stops after about 22 seconds with a clear message (Forge allows 25 s per call)
- Pasted specs up to 100,000 characters
- 10 approved hosts per list (Forge limit). Wildcards like `*.example.com` work.
- Try it out: no OAuth login flows yet (API keys and bearer tokens are fine)
- No AsyncAPI, no Azure DevOps
