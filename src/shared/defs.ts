import type {
  AppSettings,
  ApprovedHostGroup,
  ApprovedHosts,
  AuditEntryView,
  ApiListItem,
  AttachmentOption,
  CompareResponse,
  CompareTarget,
  ConnectionOption,
  GitConnection,
  GitConnectionInput,
  LoadSpecResponse,
  MacroConfig,
  ProxyRequest,
  ProxyResponse,
  Result,
} from './types';

// Shared by makeResolver (backend) and makeInvoke (UI).
export type Defs = {
  // preview = unsaved settings from the config modal
  loadSpec: (args: { preview?: MacroConfig; refresh?: boolean }) => Result<LoadSpecResponse>;
  /** Changes between the saved macro's spec and an older Git ref or attachment version. */
  compareSpec: (args: { target: CompareTarget }) => Result<CompareResponse>;
  listAttachments: () => Result<AttachmentOption[]>;
  /** Raw attachment text for the config dialog's editor (licensed users only). */
  readAttachment: (args: { filename: string }) => Result<{ text: string; version?: number }>;
  getEditorOptions: () => Result<{
    connections: ConnectionOption[];
    urlSourcesEnabled: boolean;
    tryItOutEnabled: boolean;
  }>;
  proxyRequest: (args: { request: ProxyRequest; preview?: MacroConfig }) => Result<ProxyResponse>;

  /** APIs documented in a space, filtered to pages the reader can see (space page module). */
  listSpaceApis: () => Result<{ spaceKey?: string; apis: ApiListItem[]; truncated: boolean }>;
  /** APIs across the whole site, filtered to pages the reader can see (global page module). */
  listSiteApis: () => Result<{ apis: ApiListItem[]; truncated: boolean }>;

  adminGetState: () => Result<{ settings: AppSettings; connections: GitConnection[] }>;
  adminSaveSettings: (args: { settings: AppSettings }) => Result<AppSettings>;
  adminSaveConnection: (args: { connection: GitConnectionInput }) => Result<GitConnection>;
  adminDeleteConnection: (args: { id: string }) => Result<{ id: string }>;
  adminTestConnection: (args: {
    id: string;
    repo: string;
    /** Not used for SwaggerHub. */
    path?: string;
    ref?: string;
  }) => Result<{ title: string; version: string; operationCount: number; fileCount: number }>;
  /** Turns on push webhooks with a new secret (shown once) and returns the URL to register. */
  adminEnableWebhook: (args: { id: string }) => Result<{ connection: GitConnection; url: string; secret: string }>;
  adminDisableWebhook: (args: { id: string }) => Result<GitConnection>;
  /** The webhook URL for a connection, without changing its secret. */
  adminGetWebhookUrl: (args: { id: string }) => Result<{ url: string }>;
  /** The settings page sends the approved host lists after loading them from Atlassian. */
  adminSyncHosts: (args: { hosts: Record<ApprovedHostGroup, string[]> }) => Result<ApprovedHosts>;
  adminClearCache: () => Result<{ cleared: boolean }>;
  adminGetAudit: () => Result<AuditEntryView[]>;
  /** Host approvals happen in the browser (Atlassian's consent dialog), so the UI reports them for the log. */
  adminRecordHostChange: (args: { action: 'host.approve' | 'host.remove'; host: string; group: string }) => Result<{ recorded: boolean }>;
};
