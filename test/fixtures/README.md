# Payload fixtures

Real-shaped request and response bodies, taken from each provider's published
documentation, so the parsers are tested against what the services actually
send rather than against shapes we made up. `test/fixtures.test.ts` feeds each
one through the code that reads it.

| File | Source | Notes |
| --- | --- | --- |
| `github-push.json` | GitHub's webhook payload example for `push`, as published in [octokit/webhooks](https://github.com/octokit/webhooks/blob/main/payload-examples/api.github.com/push/payload.json) (the source of the examples at [docs.github.com](https://docs.github.com/en/webhooks/webhook-events-and-payloads#push)) | Verbatim. It is a tag push. |
| `gitlab-push.json` | [GitLab webhook events: Push events](https://docs.gitlab.com/user/project/integrations/webhook_events/#push-events) | Verbatim payload example. |
| `bitbucket-push.json` | [Bitbucket Cloud event payloads: Push](https://support.atlassian.com/bitbucket-cloud/docs/event-payloads/#Push) | The documented `repo:push` template with its `Repository` placeholder replaced by the documented Repository entity sample (including its `repoitory_slug` typo). `Account`, `User`, `Project` and `Workspace` placeholders are `null`; parents and links are trimmed. |
| `azure-push.json` | [Azure DevOps service hook events: Code pushed](https://learn.microsoft.com/en-us/azure/devops/service-hooks/events#git.push) | Verbatim sample payload (resource details "All"). |
| `bitbucket-branch.json` | Example response of [Get a branch](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-refs/#api-repositories-workspace-repo-slug-refs-branches-name-get) in Bitbucket's published OpenAPI document | Verbatim. |
| `swaggerhub-default-version.json` | `GET /apis/{owner}/{api}/settings/default`, as used and stubbed by SmartBear's [swaggerhub-cli](https://github.com/SmartBear/swaggerhub-cli/blob/master/src/support/command/base-command.js) | The registry API docs host couldn't be fetched; the CLI's tests reply with this body. |
| `confluence-attachments-page1.json`, `confluence-attachments-page2.json` | [Get attachments for page](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-attachment/#api-pages-id-attachments-get) (v2) | Built field by field from the published `AttachmentBulk` and `MultiEntityLinks` schemas, which have no example bodies. Page 1 has a relative `_links.next` with a cursor, as the schema describes. |
| `confluence-pages-bulk.json` | [Get pages](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/#api-pages-get) (v2) with `body-format=atlas_doc_format` | Built from the `PageBulk` and `BodyBulk` schemas. The ADF body is a JSON string, as `BodyType.value` is a string. |
