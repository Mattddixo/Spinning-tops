# SpecPage

A Confluence Cloud macro for OpenAPI / Swagger docs, built on Atlassian Forge.

Drop it on a page, point it at a spec, and you get Swagger UI inside Confluence. Supports OpenAPI 3.0, 3.1, 3.2, Swagger 2.0 and AsyncAPI 2 and 3.

## Where specs can come from

- A `.yaml` / `.json` file attached to the page. You can upload it, or edit it and save a new version, from the macro settings.
- A Git repo: GitHub (incl. Enterprise Server), GitLab (cloud or self-hosted), Bitbucket Cloud, Azure DevOps
- SwaggerHub (cloud or on-premise), by API name and version, or the default version
- An https URL (admin has to turn this on)
- Pasted straight into the macro settings, in an editor with YAML/JSON highlighting and inline errors

Pasting a link to a spec file on github.com, gitlab.com or bitbucket.org (named `openapi` or `swagger`, `.yaml`/`.yml`/`.json`), or to an API on app.swaggerhub.com, inserts the macro with the settings filled in, as long as an admin has set up a connection for it.

If the spec is split into multiple files with relative `$ref`s, those get pulled in from the same repo/page and merged.

## Other stuff it does

- Filter by tag or path prefix, hide deprecated endpoints
- "Try it out" works. Requests go through the app backend instead of the browser, so no CORS errors. File uploads (multipart and raw binary) work, and images/PDFs come back as downloads. Off unless an admin enables it.
- Specs with relative server URLs (`/v1`) are resolved against the spec's URL when it has one. Otherwise, or if you want to point at staging, set a server URL in the macro settings.
- OAuth in Try it out: client credentials and password flows run from Swagger UI's Authorize button (token requests go through the same proxy). Flows that need a sign-in pop-up can't open inside Confluence, so there's a box to paste an access token instead.
- AsyncAPI documents render with the AsyncAPI React component: channels, operations, messages and payload schemas.
- Each space gets an "API docs" page listing every API documented in it, with search. Readers only see pages they have access to.
- Preview while you edit the macro. You can paste a file link from any of the Git providers or SwaggerHub and it fills in the rest.
- Several macros on one page work fine
- Endpoints show up in Confluence search. If the spec changes after the macro was saved, editors get a note to re-save so search catches up.
- PDF/Word export prints a table of endpoints instead of a blank box
- Guests and anonymous users on public spaces can read the docs
- Follows Confluence light/dark theme
- Git and URL specs are cached (5 min to 24 h, set by the admin)
- The settings page keeps an activity log: who changed settings, connections or approved hosts, and when (last 200 changes)

## Security notes

- The manifest doesn't allow any outside hosts. An admin approves each one (Git host, spec host, Try it out host) from the settings page. Atlassian shows its own confirmation for each, and they can be revoked under Atlassian Administration > Connected apps. The downside: apps that do this can't get the "Runs on Atlassian" badge.
- Git tokens go in Forge secret storage and never get sent to the browser. Each connection has a list of allowed repos and can be limited to certain spaces. File paths are checked (no `../`, spec files only) and the file has to parse as OpenAPI before anything is returned.
- Permission checks use the context Forge passes to the backend, not anything from the browser. Unsaved preview settings are only accepted from licensed users. The settings page checks the user is a Confluence admin.
- Licensed users read attachments as themselves. Guests/anonymous users can't, so the app reads for them, but only from the page they're already looking at.
- The Try it out proxy strips cookies and similar headers, doesn't follow redirects, and is https only. Request bodies are capped at 400 KB (350 KB for files), text responses at 4 MB and binary responses at 3 MB. Guests and anonymous users can't use it.
- The activity log stores field names only (for example "token" changed), never values.
- Uploads and attachment edits go straight from the macro settings to Confluence as the editing user, so Confluence's own page permissions apply (scope `write:confluence-file`). Saving an edit adds a new attachment version, and the editor warns if someone saved a newer version in the meantime.
- The space API list keeps one small record per macro (title, version, operation count, source label; never spec content or tokens). It's checked against the reader's permissions every time, and records for deleted pages or pages with no SpecPage macro left are removed.
- AsyncAPI is parsed on the backend. The parser compiles schemas with `new Function`, which Forge's CSP blocks in the browser, so the UI only renders the parsed result. The code editor runs in a shadow root for the same reason: CodeMirror's injected styles become constructable stylesheets there instead of inline `<style>` tags.

## Layout

```
manifest.yml        Forge manifest
src/index.ts        resolver + export handler
src/backend/        loading specs, Git/attachment/URL sources, $ref bundling, cache, proxy, admin
src/shared/         types and logic used by both backend and UI
locales/            all UI and error text (English), looked up by key
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

## UI text

All text shown to users is in `locales/en-US.json`. Backend errors are sent with a key and parameters as well as the English message, so translating later means adding catalogs, not changing code. `npm test` fails if the code uses a key the file doesn't have, or the file has keys nothing uses.

## Limits / not supported yet

- Source files up to 20 MB in total, max 50 referenced files. The bundled spec is sent gzip'd and has to fit in 4.5 MB after compression (Forge caps responses at 5 MB). Most specs compress about 10x.
- Loading stops after about 22 seconds with a clear message (Forge allows 25 s per call)
- Pasted specs up to 100,000 characters
- 10 approved hosts per list (Forge limit). Wildcards like `*.example.com` work.
- Try it out: OAuth flows that need a sign-in pop-up (authorization code, implicit, OpenID Connect) can't run inside Confluence; paste a token instead. No Try it out for AsyncAPI.
- Tag/path filters apply to OpenAPI and Swagger only. AsyncAPI documents are shown whole.
- AsyncAPI message payloads in Avro, RAML or Protobuf schema formats aren't supported yet (JSON Schema and AsyncAPI schemas are).
- Link autoconvert only knows the public hosts above, and not Azure DevOps (its file links keep the path in the query string, so a pattern would catch every repo link).
- Attachments over 2 MB can't be edited in the macro settings (upload a new version instead).
- The space API list shows a page once it has been viewed after the macro was added. If a page had several SpecPage macros and one is removed, its entry stays until the last one goes.
