# Marketplace listing draft

Copy for the Atlassian Marketplace listing, written to Atlassian's field limits
([Building your presence on Marketplace](https://developer.atlassian.com/platform/marketplace/building-your-presence-on-marketplace/)).
`node scripts/check-listing.mjs` checks every field against its limit.

The angle: most OpenAPI apps on the Marketplace wrap Swagger UI and stop there.
Lead with what only SpecPage does (breaking-change comparison, the API catalog,
the Quality score) and with the two things reviewers of other apps complain
about most: "Try it out" failing with CORS errors, and tokens showing up in the
macro settings.

## App name

<!-- field: name, max 60 -->
SpecPage: OpenAPI and Swagger Docs for Confluence
<!-- /field -->

## Tagline

<!-- field: tagline, max 130 -->
Interactive API docs from Git, attachments or URLs, with breaking-change checks, a quality score and a searchable API catalog.
<!-- /field -->

## Summary (shown in search results)

<!-- field: summary, max 250 -->
Show OpenAPI, Swagger and AsyncAPI specs on Confluence pages, straight from GitHub, GitLab, Bitbucket, Azure DevOps, SwaggerHub or an attachment. Compare versions for breaking changes, and find every API in one catalog.
<!-- /field -->

## Highlights

Screenshots are 1840 x 900 (plus a 580 x 330 crop). Suggested shots are noted
under each one; take them on the dev site with the sample API.

### 1

<!-- field: highlight1.title, max 50 -->
See what changed before it breaks clients
<!-- /field -->

<!-- field: highlight1.summary, max 220 -->
Compare the spec with any branch, tag, commit or earlier attachment version. Removed endpoints and new required fields come first, and the list downloads as Markdown for release notes.
<!-- /field -->

Screenshot: the Changes panel open on a macro, with a breaking change, a
warning and an info item, and the Download button visible.

### 2

<!-- field: highlight2.title, max 50 -->
Docs that stay in sync with your repo
<!-- /field -->

<!-- field: highlight2.summary, max 220 -->
Point a macro at a file in Git or SwaggerHub, or paste its link. Split specs with $refs are merged, and with a push webhook readers see changes straight away. Tokens never reach the browser.
<!-- /field -->

Screenshot: the macro settings with a GitHub connection selected and the live
preview on the right.

### 3

<!-- field: highlight3.title, max 50 -->
Every API in your site, in one place
<!-- /field -->

<!-- field: highlight3.summary, max 220 -->
Each space gets an API docs page and the whole site gets a catalog, both searchable and limited to pages the reader can open. Endpoints also show up in Confluence search.
<!-- /field -->

Screenshot: the site-wide API catalog with a few entries and the search box in
use.

## More details

<!-- field: details, max 1000 -->
SpecPage puts interactive API reference docs on any Confluence page.

- OpenAPI 3.0, 3.1 and 3.2, Swagger 2.0, AsyncAPI 2 and 3
- Specs from attachments, GitHub (incl. Enterprise Server), GitLab, Bitbucket, Azure DevOps, SwaggerHub, an https URL, or pasted in
- Try it out runs through the app, so there are no CORS errors. File uploads and OAuth client credentials work
- Code samples in cURL, JavaScript, Python, Go, Java and C#
- A Quality tab scores your docs out of 100 and lists what to fix
- Filter by tag or path, hide deprecated endpoints, live preview while editing
- Guests and anonymous readers on public spaces can read the docs
- PDF and Word export, light and dark theme

Security: Git tokens live in Forge secret storage and never reach the browser. Admins approve each outside host, with separate lists for Git, spec URLs and Try it out, and settings changes go in an activity log.

Swagger is a trademark of SmartBear Software, Inc. SpecPage is not affiliated with SmartBear.
<!-- /field -->

## Pricing

Free for up to 10 users, like most apps in this category, so a team can try it
without a purchase order. Above that, price near the paid Swagger apps rather
than the diagram bundles: the comparison, catalog and webhooks are the reason
to pay.

## Search keywords

openapi, swagger, asyncapi, api documentation, api reference, swagger ui,
breaking changes, api catalog, github, gitlab, bitbucket, azure devops,
swaggerhub

## Before submitting

- Take the three screenshots on the dev site (the sample API is the quickest
  way to get a good-looking page).
- A 30-second video of pasting a GitHub link and seeing the docs appear is
  worth having; Atlassian notes users prefer short videos that show the app
  in use.
- Apply for the Cloud Fortified and bug bounty programs once the app is
  live; several competitors show both badges. Runs on Atlassian isn't
  possible while the app calls outside hosts (Git, URLs, Try it out).
