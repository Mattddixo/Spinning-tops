// Types used by both the backend and the UI. Keep runtime imports out of here.

export type SourceType = 'attachment' | 'git' | 'url' | 'inline';

export type DocExpansion = 'list' | 'full' | 'none';

// Saved via view.submit({ config }). Forge rejects null, so leave fields out instead.
export interface MacroConfig {
  sourceType?: SourceType;

  /** Filename of an attachment on the current page (typed `attachment` parameter). */
  attachment?: string;

  /** Git source. */
  gitConnectionId?: string;
  gitRepo?: string;
  gitRef?: string;
  gitPath?: string;

  /** Public or admin-approved URL source (https only). */
  url?: string;

  /** Spec text pasted into the config modal. */
  inlineSpec?: string;

  /** Display options. */
  title?: string;
  includeTags?: string[];
  includePaths?: string[];
  hideDeprecated?: boolean;
  docExpansion?: DocExpansion;
  showModels?: boolean;
  showInfo?: boolean;
  showServers?: boolean;
  showFilter?: boolean;
  tryItOut?: boolean;
  /** Code samples in each operation (default on). */
  showCodeSamples?: boolean;
  /** Maximum height in pixels; 0 means grow with content. */
  maxHeight?: number;
  /** Replaces the spec's servers, e.g. to point "Try it out" at staging. */
  serverUrl?: string;

  /** Plain-text summary indexed by Confluence search (typed `string` parameter with indexing). */
  searchText?: string;
}

export type SpecKind = 'openapi-3.0' | 'openapi-3.1' | 'openapi-3.2' | 'swagger-2.0' | 'asyncapi-2' | 'asyncapi-3';

export interface OperationSummary {
  method: string;
  path: string;
  summary?: string;
  operationId?: string;
  tags: string[];
  deprecated: boolean;
}

export interface SpecSummary {
  kind: SpecKind;
  title: string;
  version: string;
  description?: string;
  servers: string[];
  tags: string[];
  operations: OperationSummary[];
}

export interface LoadedSpecMeta {
  sourceLabel: string;
  /** Web link to the source (Git file page or URL), when one exists. */
  sourceLink?: string;
  fetchedAt: string;
  fromCache: boolean;
  /** Number of files merged when resolving relative `$ref`s. */
  fileCount: number;
  warnings: Notice[];
  /** Set when the settings were worked out from a pasted link and haven't been saved yet. */
  autoConverted?: MacroConfig;
  /** False when servers are relative and couldn't be resolved, so Try it out needs a server override. */
  serversResolvable: boolean;
}

export type ErrorCode =
  | 'NOT_CONFIGURED'
  | 'LICENSE_INACTIVE'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'EGRESS_NOT_APPROVED'
  | 'SOURCE_DISABLED'
  | 'INVALID_SPEC'
  | 'UNSUPPORTED_SPEC'
  | 'TOO_LARGE'
  | 'UPSTREAM_ERROR'
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'INTERNAL';

export type MessageParams = Record<string, string | number>;

export interface AppError {
  code: ErrorCode;
  /** English text, used when no translation is available. */
  message: string;
  /** Catalog key for `message`, e.g. "errors.gitRefNotFound". */
  key?: string;
  params?: MessageParams;
  /** What the user can do about it (catalog key + English fallback). */
  hintKey?: string;
  hintParams?: MessageParams;
  hint?: string;
  /** Technical detail (parser output, upstream text). Not translated. */
  detail?: string;
}

export interface Notice {
  key: string;
  params?: MessageParams;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export interface LoadSpecResponse {
  /** The bundled spec as gzip-compressed JSON, base64 encoded (keeps big specs under Forge's 5 MB response cap). */
  specGz: string;
  summary: SpecSummary;
  meta: LoadedSpecMeta;
  tryItOutAllowed: boolean;
}

export type ChangeLevel = 'breaking' | 'warning' | 'info';

export const CHANGE_CODES = [
  'operationRemoved',
  'operationAdded',
  'operationDeprecated',
  'parameterAdded',
  'requiredParameterAdded',
  'parameterRemoved',
  'parameterBecameRequired',
  'parameterBecameOptional',
  'requestBodyAdded',
  'requiredRequestBodyAdded',
  'requestBodyRemoved',
  'requestBodyBecameRequired',
  'requestMediaTypeAdded',
  'requestMediaTypeRemoved',
  'responseAdded',
  'responseRemoved',
  'responseMediaTypeRemoved',
  'securityAdded',
  'securityChanged',
  'typeChanged',
  'formatChanged',
  'enumAdded',
  'enumRemoved',
  'enumValueAdded',
  'enumValueRemoved',
  'limitTightened',
  'limitLoosened',
  'compositionChanged',
  'propertyAdded',
  'requiredPropertyAdded',
  'propertyRemoved',
  'propertyBecameRequired',
  'propertyBecameOptional',
] as const;

export type ChangeCode = (typeof CHANGE_CODES)[number];

export interface SpecChange {
  level: ChangeLevel;
  code: ChangeCode;
  /** "GET /pets/{id}" */
  operation?: string;
  /** Where in the operation: the request body or a response (by status). Parameters say so in `location`. */
  section?: 'requestBody' | 'response';
  status?: string;
  /** Parameter label or property path, e.g. "limit (query)" or "items[].name". */
  location?: string;
  params?: MessageParams;
}

export interface SpecDiff {
  changes: SpecChange[];
  counts: Record<ChangeLevel, number>;
  /** True when the list was cut short (very large specs). */
  truncated: boolean;
}

/** What to compare the macro's current spec against. */
export interface CompareTarget {
  /** Git: another branch, tag or commit. */
  gitRef?: string;
  /** Attachment: an older version number. Defaults to the previous version. */
  attachmentVersion?: number;
}

export interface CompareResponse extends SpecDiff {
  baseLabel: string;
  baseVersion: string;
  headLabel: string;
  headVersion: string;
}

export const QUALITY_CHECK_IDS = [
  'infoDescription',
  'contact',
  'servers',
  'securityDefined',
  'operationSummary',
  'operationDescription',
  'operationId',
  'operationTags',
  'tagDescriptions',
  'successResponse',
  'errorResponse',
  'parameterDescription',
  'requestExample',
  'responseExample',
  'schemaDescription',
] as const;

export type QualityCheckId = (typeof QUALITY_CHECK_IDS)[number];

export interface QualityCheck {
  id: QualityCheckId;
  /** Counts double in the score. */
  important: boolean;
  passed: number;
  total: number;
  failed: number;
  /** First few things that failed, e.g. "GET /pets" or "limit (query)". */
  examples: string[];
  /** How many more failed beyond `examples`. */
  more: number;
}

export interface QualityReport {
  /** 0-100. */
  score: number;
  checks: QualityCheck[];
  duplicateOperationIds: string[];
}

/** Where a connection reads specs from. SwaggerHub isn't Git, but it fits the same connection model. */
export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'swaggerhub';

/** `pat` is Basic auth with an empty username, which is how Azure DevOps takes personal access tokens. */
export type GitAuthType = 'bearer' | 'basic' | 'private-token' | 'pat' | 'none';

/** Connection metadata. The token itself lives only in Forge secret storage. */
export interface GitConnection {
  id: string;
  name: string;
  provider: GitProvider;
  /** API base URL, e.g. https://api.github.com or https://gitlab.example.com/api/v4 */
  apiBaseUrl: string;
  /** Web base URL used to build "view source" links, e.g. https://github.com */
  webBaseUrl: string;
  authType: GitAuthType;
  /** Username for Basic auth (Bitbucket API tokens use the Atlassian account email). */
  username?: string;
  /** Allowed repositories, e.g. ["acme/payments-api", "acme/*"]. Empty means none. */
  repos: string[];
  /** Optional space keys allowed to use this connection. Empty means all spaces. */
  spaceKeys: string[];
  defaultRef?: string;
  hasToken: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GitConnectionInput {
  id?: string;
  name: string;
  provider: GitProvider;
  apiBaseUrl: string;
  webBaseUrl: string;
  authType: GitAuthType;
  username?: string;
  repos: string[];
  spaceKeys: string[];
  defaultRef?: string;
  /** New token. Omit to keep the stored token; empty string removes it. */
  token?: string;
}

export interface AppSettings {
  /** Allow page editors to load specs from URLs on admin-approved hosts. */
  urlSourcesEnabled: boolean;
  /** Allow "Try it out" requests, proxied through the app to admin-approved hosts. */
  tryItOutEnabled: boolean;
  /** Minutes to cache specs loaded from Git or URLs. 0 disables caching. */
  cacheTtlMinutes: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  urlSourcesEnabled: false,
  tryItOutEnabled: false,
  cacheTtlMinutes: 10,
};

/** Public subset of a connection shown to page editors in the config modal. */
export interface ConnectionOption {
  id: string;
  name: string;
  provider: GitProvider;
  /** Host of the web URL, used to match pasted links (github.com vs a GitHub Enterprise host). */
  webHost: string;
  repos: string[];
  defaultRef?: string;
}

export interface ProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Text body. */
  body?: string;
  /** Binary body (file uploads, multipart), base64 encoded. Wins over `body`. */
  bodyBase64?: string;
}

export interface ProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Text responses. */
  body?: string;
  /** Binary responses (images, PDFs, archives), base64 encoded. */
  bodyBase64?: string;
  truncated: boolean;
}

export type AuditAction =
  | 'settings.update'
  | 'connection.create'
  | 'connection.update'
  | 'connection.delete'
  | 'cache.clear'
  | 'host.approve'
  | 'host.remove';

export interface AuditEntry {
  at: string;
  accountId: string;
  action: AuditAction;
  /** Connection name, host, etc. */
  target?: string;
  /** Short machine-readable list of what changed, e.g. ["repos", "token"]. */
  changes?: string[];
}

export interface AuditEntryView extends AuditEntry {
  displayName?: string;
}

/** One API doc macro, as stored in the space registry (backend/catalog.ts). */
export interface ApiEntry {
  spaceId: string;
  contentId: string;
  contentType: 'page' | 'blogpost';
  localId: string;
  title: string;
  version: string;
  kind: SpecKind;
  operationCount: number;
  sourceType: SourceType;
  /** Where the spec comes from (file name, repo path, URL); empty for pasted specs. */
  sourceLabel: string;
  fingerprint: string;
  updatedAt: string;
}

export interface ApiListItem extends ApiEntry {
  pageTitle: string;
}

export interface AttachmentOption {
  /** Current version number, used to warn about overwriting someone else's change. */
  version?: number;
  title: string;
  mediaType?: string;
  fileSize?: number;
}

/** Egress group keys used with customer-managed egress. */
export const EGRESS_GROUPS = {
  git: 'specpage-git-hosts',
  specs: 'specpage-spec-hosts',
  apis: 'specpage-api-hosts',
} as const;
