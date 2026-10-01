import { useMemo } from 'react';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import '../styles/swagger-theme.css';
import { filterSpec } from '../../../../src/shared/spec';
import type { MacroConfig, ProxyResponse } from '../../../../src/shared/types';
import { call, invoke } from '../api';

interface ApiDocsProps {
  spec: Record<string, unknown>;
  config: MacroConfig;
  tryItOutAllowed: boolean;
  /** Unsaved config from the editor, passed to the proxy so preview "Try it out" works. */
  preview?: MacroConfig;
}

type SwaggerRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  userFetch?: (url: string, init: unknown) => Promise<Response>;
};

function bodyToText(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    throw new Error('Multipart (file upload) requests are not supported by "Try it out" in Confluence.');
  }
  return JSON.stringify(body);
}

/**
 * Swagger UI calls `request.userFetch` when it is set (swagger-client http).
 * Requests are relayed through the app backend, which avoids browser CORS
 * restrictions and enforces the admin's host approvals.
 */
function proxyFetch(preview?: MacroConfig) {
  return async (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown }): Promise<Response> => {
    const result: ProxyResponse = await call(
      invoke('proxyRequest', {
        request: { url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: bodyToText(init.body) },
        ...(preview ? { preview } : {}),
      }),
    );
    const headers = new Headers();
    for (const [k, v] of Object.entries(result.headers)) {
      try {
        headers.append(k, v);
      } catch {
        // Skip header names the browser refuses to construct.
      }
    }
    const nullBody = result.status === 204 || result.status === 205 || result.status === 304 || init.method === 'HEAD';
    const body = result.truncated ? `${result.body}\n\n[Response truncated by SpecPage at 4 MB]` : result.body;
    return new Response(nullBody ? null : body, { status: Math.min(Math.max(result.status, 200), 599), statusText: result.statusText, headers });
  };
}

export function ApiDocs({ spec, config, tryItOutAllowed, preview }: ApiDocsProps) {
  const filtered = useMemo(
    () => filterSpec(spec, { includeTags: config.includeTags, includePaths: config.includePaths, hideDeprecated: config.hideDeprecated }),
    [spec, config.includeTags, config.includePaths, config.hideDeprecated],
  );

  const requestInterceptor = useMemo(() => {
    const userFetch = proxyFetch(preview);
    return (req: Record<string, unknown>) => {
      (req as SwaggerRequest).userFetch = userFetch as SwaggerRequest['userFetch'];
      return req;
    };
  }, [preview]);

  const classes = [
    'sp-docs',
    config.showInfo === false && 'sp-docs-hide-info',
    config.showServers === false && 'sp-docs-hide-servers',
    !tryItOutAllowed && 'sp-docs-readonly',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <SwaggerUI
        spec={filtered}
        docExpansion={config.docExpansion ?? 'list'}
        defaultModelsExpandDepth={config.showModels === false ? -1 : 1}
        filter={config.showFilter === true}
        deepLinking={false}
        queryConfigEnabled={false}
        persistAuthorization={false}
        withCredentials={false}
        displayRequestDuration
        requestSnippetsEnabled
        supportedSubmitMethods={tryItOutAllowed ? ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'] : []}
        requestInterceptor={requestInterceptor}
      />
    </div>
  );
}
