import type {
  AppSettings,
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
  listSpaceApis: () => Result<{ spaceKey?: string; apis: ApiListItem[] }>;

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
  adminClearCache: () => Result<{ cleared: boolean }>;
  adminGetAudit: () => Result<AuditEntryView[]>;
  /** Host approvals happen in the browser (Atlassian's consent dialog), so the UI reports them for the log. */
  adminRecordHostChange: (args: { action: 'host.approve' | 'host.remove'; host: string; group: string }) => Result<{ recorded: boolean }>;
};
