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
- Compare with an earlier version: signed-in readers can pick a Git branch, tag or commit (or an older attachment version, the previous one by default) and see what changed, with breaking changes first. A removed endpoint, a new required parameter or a required property dropped from a response counts as breaking; a deprecation, a dropped optional response property or a new value in a response enum is flagged to check. The list downloads as Markdown for release notes.
- "Try it out" works. Requests go through the app backend instead of the browser, so no CORS errors. File uploads (multipart and raw binary) work, and images/PDFs come back as downloads. Off unless an admin enables it.
- Specs with relative server URLs (`/v1`) are resolved against the spec's URL when it has one. Otherwise, or if you want to point at staging, set a server URL in the macro settings.
- OAuth in Try it out: client credentials and password flows run from Swagger UI's Authorize button (token requests go through the same proxy, so the identity provider's token host needs to be on the Try it out list too). Sign-in flows that need a pop-up window can't open inside Confluence. Readers who already have an access token for the API can paste it into a password field instead. It's kept in memory for that page only, never saved or logged, and only sent to hosts an admin has approved for Try it out.
- AsyncAPI documents render with the AsyncAPI React component: channels, operations, messages and payload schemas.
- Each space gets an "API docs" page listing every API documented in it, and there's a site-wide "API catalog" in the Apps menu. Both have search, and readers only see pages they have access to.
- Code samples in each endpoint: cURL, JavaScript, Python, Go, Java and C#, built from the spec's parameters, auth and example bodies. Samples the spec already carries (`x-codeSamples`) come first. The chosen language sticks across endpoints. Can be turned off per macro.
- A Quality tab in the macro settings scores the docs out of 100 and lists what's missing: endpoint summaries, error responses, parameter descriptions, examples and so on, with the endpoints that need work. It judges what readers will see, so tag and path filters count. Runs in the browser; nothing is sent anywhere.
- Preview while you edit the macro. You can paste a file link from any of the Git providers or SwaggerHub and it fills in the rest.
- Several macros on one page work fine
- Endpoints show up in Confluence search. If the spec changes after the macro was saved, editors get a note to re-save so search catches up.
- PDF/Word export prints a table of endpoints instead of a blank box
- Guests and anonymous users on public spaces can read the docs
- Follows Confluence light/dark theme
- Git and URL specs are cached (5 min to 24 h, set by the admin). Turn on a webhook for a Git connection (GitHub, GitLab, Bitbucket or Azure DevOps) and a push refreshes that repo's specs straight away.
- The settings page keeps an activity log: who changed settings, connections or approved hosts, and when (last 200 changes)

## Security notes

- The manifest doesn't allow any outside hosts. An admin approves each one (Git host, spec host, Try it out host) from the settings page. Atlassian shows its own confirmation for each, and they can be revoked under Atlassian Administration > Connected apps. The downside: apps that do this can't get the "Runs on Atlassian" badge.
- Each host list only works for its own purpose. Forge itself checks outgoing requests against every approved host, so the settings page also saves a copy of the lists (admins only) and the backend checks against the right one: Try it out can only call hosts on the Try it out list, and URL sources and absolute `$ref`s can only read hosts on the spec list (Git connections use their own API address). The copy can only narrow what Forge allows: a host removed in Atlassian Administration is still blocked, and a host added there is refused by SpecPage until an admin opens the SpecPage settings page once, which re-syncs the copy. Until the first sync, Try it out and URL sources are refused. Matching uses Forge's own host matcher, so `*.example.com` works the same way.
- Git tokens go in Forge secret storage and never get sent to the browser. Each connection has a list of allowed repos and can be limited to certain spaces. File paths are checked (no `../`, spec files only) and the file has to parse as OpenAPI before anything is returned.
- Permission checks use the context Forge passes to the backend, not anything from the browser. Unsaved preview settings are only accepted from licensed users. The settings page checks the user is a Confluence admin.
- For Try it out, the real controls are the site-wide setting and the Try it out host list. The switch on each macro decides whether that macro shows Try it out, but a licensed user could turn it on in an unsaved preview, so treat it as a display choice, not a restriction.
- Changing a Git connection's API address or provider requires entering the token again, so a saved token is never sent to a different host.
- Licensed users read attachments as themselves. Guests/anonymous users can't, so the app reads for them, but only from the page they're already looking at.
- The Try it out proxy strips cookies and similar headers, doesn't follow redirects, and is https only. Request bodies are capped at 400 KB (350 KB for files), text responses at 4 MB and binary responses at 3 MB. Guests and anonymous users can't use it.
- Git requests follow redirects themselves: tokens only go to the original host, and a redirect to a non-https address is refused.
- Webhooks: the web trigger URL is public, as with all Forge web triggers, so every request is checked against that connection's own secret before anything in it is read: HMAC-SHA256 signatures for GitHub and Bitbucket, the token for GitLab, the basic-auth password for Azure DevOps. Comparisons are constant time. Unknown connections and connections without a webhook get the same 404. A valid push only marks cached specs as stale, so a replayed request costs at most one extra fetch. Secrets live in Forge secret storage, are shown once, and are deleted with the connection.
- Comparisons are for licensed users only and use the macro's saved settings, so they reach the same repos and attachments the macro already can.
- Credentials readers type into Try it out (a pasted access token, or what they enter in Swagger UI's Authorize dialog, such as an API key or OAuth client secret) stay in the page's memory and are gone when the page closes. They're never saved to Confluence, app storage or browser storage, and the backend doesn't log requests. They do pass through the app's backend on Forge, because every Try it out request does (browsers block calling the API directly), and they can only go to hosts an admin has approved for Try it out.
- The activity log never stores tokens or connection details: connection changes are recorded by field name only (for example "token" changed). Site settings changes record the new value (for example `tryItOutEnabled=true`), since those are on/off switches and cache times. Host approvals and removals are recorded when they're made from the SpecPage settings page; changes made directly in Atlassian Administration don't appear in the log.
- Uploads and attachment edits go straight from the macro settings to Confluence as the editing user, so Confluence's own page permissions apply (scope `write:confluence-file`). Saving an edit adds a new attachment version, and the editor warns if someone saved a newer version in the meantime.
- The space API list keeps one small record per macro (title, version, operation count, source label; never spec content or tokens). It's checked against the reader's permissions every time. Records for pages that no longer have a SpecPage macro are removed. Pages a reader can't see are just hidden from that reader (they may be restricted, not deleted); their records are only removed once nobody has viewed the page for 90 days.
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
npm run coverage     # unit tests with a coverage report (fails below the thresholds in vitest.config.mts)
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

Webhooks need the web trigger in manifest.yml to be deployed; after that the URL stays the same across deploys.

## Upgrading

After deploying a version that includes the per-list host check (October 2026), a Confluence admin needs to open **SpecPage settings** once. Until then, Try it out and URL sources are refused.

Why: Forge checks outgoing requests against every approved host, but the app's backend can't read which list (Git, specs or Try it out) a host was approved in. The settings page saves a copy of the lists when it opens, and the backend uses that copy to make sure each host is only used for its own purpose. Before the first copy exists, the safe default is to allow nothing extra. Readers see a plain "not available right now" message; editors see what to do.

The same applies whenever hosts are approved directly in Atlassian Administration rather than on the SpecPage settings page: open the settings page once afterwards.

## Maintenance

`npm run maintenance` checks both package folders for outdated packages and known vulnerabilities, compares your Node version with the Forge runtime in manifest.yml, and writes `maintenance-report.md`. Add `-- --full` to also run typecheck, lint, tests and build. It exits with code 1 when something needs attention soon (a high or critical vulnerability, or a failed check).

It doesn't cover Forge platform changes; check the [Forge changelog](https://developer.atlassian.com/platform/forge/changelog/) for deprecations and runtime end-of-life dates.

## UI text

All text shown to users is in `locales/en-US.json`. Backend errors are sent with a key and parameters as well as the English message, so translating later means adding catalogs, not changing code. `npm test` fails if the code uses a key the file doesn't have, or the file has keys nothing uses.

## Limits / not supported yet

- Source files up to 20 MB in total, max 50 referenced files. The bundled spec is sent gzip'd and has to fit in 4.5 MB after compression (Forge caps responses at 5 MB). Most specs compress about 10x.
- Loading stops after about 22 seconds with a clear message (Forge allows 25 s per call)
- Pasted specs up to 100,000 characters
- 10 approved hosts per list (Forge limit). Wildcards like `*.example.com` work.
- Try it out: OAuth flows that need a sign-in pop-up (authorization code, implicit, OpenID Connect) can't run inside Confluence; paste a token instead. No Try it out for AsyncAPI.
- Azure DevOps webhooks need "Resource details to send" left on All (the default) to refresh just the pushed repo; with Minimal or None every repo on that connection is refreshed.
- Comparisons work for Git and attachment sources, OpenAPI and Swagger only. `oneOf`/`anyOf` edits are flagged to check by hand rather than judged. Lists show up to 500 changes, breaking ones first; the counts cover everything found.
- OpenAPI 3.2: `query` operations are shown, searchable, exported, compared and get code samples, but Try it out isn't offered for them. `additionalOperations` aren't shown, because Swagger UI doesn't render them yet.
- Tag/path filters apply to OpenAPI and Swagger only. AsyncAPI documents are shown whole.
- AsyncAPI message payloads in Avro, RAML or Protobuf schema formats aren't supported yet (JSON Schema and AsyncAPI schemas are).
- Link autoconvert only knows the public hosts above, and not Azure DevOps (its file links keep the path in the query string, so a pattern would catch every repo link).
- Attachments over 2 MB can't be edited in the macro settings (upload a new version instead).
- The site-wide catalog checks up to 2,000 macros per load and space pages up to 1,000 each; both say so when there are more (the site list also when it ran short of time). Hidden entries for restricted pages, or pages deleted in the last 90 days, count toward those limits. Entries recorded before the catalog existed show the space key once their page is viewed again. A page whose macro was removed drops off the site catalog once its space's API docs page has been opened.
- The space API list shows a page once it has been viewed after the macro was added. If a page had several SpecPage macros and one is removed, its entry stays until the last one goes.
