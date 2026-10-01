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

/**
 * Type-safe contract between `makeResolver` (backend) and `makeInvoke` (UI).
 * See https://developer.atlassian.com/platform/forge/runtime-reference/forge-resolver/
 */
export type Defs = {
  /**
   * Load, bundle and validate the spec for the current macro.
   * `preview` lets an editor render unsaved settings from the config modal.
   */
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
