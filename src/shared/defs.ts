import type {
  AppSettings,
  AttachmentOption,
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
  listAttachments: () => Result<AttachmentOption[]>;
  getEditorOptions: () => Result<{
    connections: ConnectionOption[];
    urlSourcesEnabled: boolean;
    tryItOutEnabled: boolean;
  }>;
  proxyRequest: (args: { request: ProxyRequest; preview?: MacroConfig }) => Result<ProxyResponse>;

  adminGetState: () => Result<{ settings: AppSettings; connections: GitConnection[] }>;
  adminSaveSettings: (args: { settings: AppSettings }) => Result<AppSettings>;
  adminSaveConnection: (args: { connection: GitConnectionInput }) => Result<GitConnection>;
  adminDeleteConnection: (args: { id: string }) => Result<{ id: string }>;
  adminTestConnection: (args: {
    id: string;
    repo: string;
    path: string;
    ref?: string;
  }) => Result<{ title: string; version: string; operationCount: number; fileCount: number }>;
  adminClearCache: () => Result<{ cleared: boolean }>;
};
