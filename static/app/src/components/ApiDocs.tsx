import { useId, useMemo, useRef, useState, type ComponentType } from 'react';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import '../styles/swagger-theme.css';
import { appError } from '../../../../src/shared/messages';
import { applyServerOverride, detectKind, filterSpec } from '../../../../src/shared/spec';
import type { MacroConfig, ProxyRequest, ProxyResponse, SpecKind } from '../../../../src/shared/types';
import { call, invoke, RequestFailed } from '../api';
import { useT } from '../i18n';
import type { Translate } from '../../../../src/shared/i18n';
import { base64ToBytes, bytesToBase64 } from '../spec-transport';
import { CodeSamples } from './CodeSamples';

interface ApiDocsProps {
  spec: Record<string, unknown>;
  config: MacroConfig;
  tryItOutAllowed: boolean;
  // unsaved config, so Try it out works in the preview
  preview?: MacroConfig;
}

type SwaggerRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  userFetch?: (url: string, init: unknown) => Promise<Response>;
};

// Matches the backend limit in proxy.ts (Forge caps invoke payloads at 500 KB).
const MAX_BINARY_BODY = 350_000;

type EncodedBody = Pick<ProxyRequest, 'body' | 'bodyBase64'> & { contentType?: string };

// swagger-client hands us strings for JSON/XML/urlencoded bodies, FormData for
// multipart and a File/Blob for application/octet-stream uploads. Strings go as
// text; the rest is serialised to bytes and sent base64.
async function encodeBody(body: unknown): Promise<EncodedBody> {
  if (body === undefined || body === null) return {};
  if (typeof body === 'string') return { body };
  if (body instanceof URLSearchParams) return { body: body.toString() };

  let bytes: Uint8Array;
  let contentType: string | undefined;
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    // Let the browser produce the multipart encoding and its boundary.
    const encoded = new Response(body);
    contentType = encoded.headers.get('content-type') ?? undefined;
    bytes = new Uint8Array(await encoded.arrayBuffer());
  } else if (body instanceof Blob) {
    contentType = body.type || undefined;
    bytes = new Uint8Array(await body.arrayBuffer());
  } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  } else {
    return { body: JSON.stringify(body) };
  }
  if (bytes.byteLength > MAX_BINARY_BODY) {
    throw new RequestFailed(appError('TOO_LARGE', 'errors.requestTooLarge', { size: MAX_BINARY_BODY / 1000 }));
  }
  return { bodyBase64: bytesToBase64(bytes), contentType };
}

function hasHeader(headers: Record<string, string>, name: string) {
  return Object.keys(headers).some((k) => k.toLowerCase() === name);
}

// swagger-client uses request.userFetch if it's set, so we point it at the
// backend proxy instead of the browser's fetch.
function proxyFetch(t: Translate, preview?: MacroConfig) {
  return async (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown }): Promise<Response> => {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = { ...(init.headers ?? {}) };
    const { contentType, ...body } = await encodeBody(init.body);
    // swagger-client strips Content-Type for multipart so fetch can add the
    // boundary; we have to put it back ourselves.
    if (contentType && !hasHeader(headers, 'content-type')) headers['Content-Type'] = contentType;

    let result: ProxyResponse;
    try {
      result = await call(invoke('proxyRequest', { request: { url, method, headers, ...body }, ...(preview ? { preview } : {}) }));
    } catch (err) {
      // Swagger UI shows thrown errors under the request, so give it readable text.
      const error = err instanceof RequestFailed ? err.error : undefined;
      throw new Error(error?.key ? t(error.key, error.params) : err instanceof Error ? err.message : String(err), { cause: err });
    }

    const responseHeaders = new Headers();
    for (const [k, v] of Object.entries(result.headers)) {
      try {
        responseHeaders.append(k, v);
      } catch {
        // Skip header names the browser refuses to construct.
      }
    }
    const nullBody = result.status === 204 || result.status === 205 || result.status === 304 || method === 'HEAD';
    let responseBody: BodyInit | null = null;
    if (!nullBody) {
      if (result.bodyBase64 !== undefined) responseBody = base64ToBytes(result.bodyBase64);
      else responseBody = result.truncated ? `${result.body ?? ''}\n\n${t('ui.docs.truncated')}` : (result.body ?? '');
    }
    // Response() rejects statuses outside 200-599; 1xx/3xx shouldn't reach us
    // (redirects aren't followed) but clamp so a bad upstream can't crash the UI.
    const status = result.status >= 200 && result.status <= 599 ? result.status : 502;
    return new Response(responseBody, { status, statusText: result.statusText, headers: responseHeaders });
  };
}

// OAuth flows that need a sign-in pop-up (authorization code, implicit,
// OpenID Connect) can't complete inside Confluence's sandboxed iframe, and
// Swagger UI has no field to paste a token for them. Readers can paste one
// here instead; it's added as a Bearer header when a request has none.
function oauthSchemes(spec: Record<string, unknown>): string[] {
  const components = spec.components as { securitySchemes?: Record<string, { type?: string }> } | undefined;
  const swagger2 = spec.securityDefinitions as Record<string, { type?: string }> | undefined;
  const schemes = { ...(components?.securitySchemes ?? {}), ...(swagger2 ?? {}) };
  return Object.entries(schemes)
    .filter(([, s]) => s && (s.type === 'oauth2' || s.type === 'openIdConnect'))
    .map(([name]) => name);
}

function TokenBar({ onChange }: { onChange: (token: string) => void }) {
  const t = useT();
  const id = useId();
  const [value, setValue] = useState('');
  return (
    <div className="sp-token-bar">
      <label className="sp-label" htmlFor={id}>
        {t('ui.docs.tokenLabel')}
      </label>
      <div className="sp-row sp-row-nowrap">
        <input
          id={id}
          className="sp-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('ui.docs.tokenPlaceholder')}
          aria-describedby={`${id}-help`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onChange(e.target.value.trim().replace(/^Bearer\s+/i, ''));
          }}
        />
      </div>
      <span id={`${id}-help`} className="sp-help">
        {t('ui.docs.tokenHelp')}
      </span>
    </div>
  );
}

// Swagger UI plugin that shows code samples in each expanded operation, just
// above its responses. Swagger UI passes the operation's path and method to
// its "responses" component; the samples are built from our own copy of the
// spec, read through a ref so the plugin itself never changes.
function codeSamplesPlugin(current: { spec: Record<string, unknown>; kind?: SpecKind }) {
  return () => ({
    wrapComponents: {
      responses: (Original: ComponentType<Record<string, unknown>>) =>
        function ResponsesWithSamples(props: Record<string, unknown>) {
          const { path, method } = props;
          return (
            <>
              {current.kind && typeof path === 'string' && typeof method === 'string' ? (
                <CodeSamples spec={current.spec} kind={current.kind} path={path} method={method} />
              ) : null}
              <Original {...props} />
            </>
          );
        },
    },
  });
}

export function ApiDocs({ spec, config, tryItOutAllowed, preview }: ApiDocsProps) {
  const t = useT();
  // Kept in a ref: changing it must not re-render (and reset) Swagger UI.
  const pastedToken = useRef('');
  const needsTokenBar = useMemo(() => tryItOutAllowed && oauthSchemes(spec).length > 0, [spec, tryItOutAllowed]);
  const prepared = useMemo(() => {
    const filtered = filterSpec(spec, { includeTags: config.includeTags, includePaths: config.includePaths, hideDeprecated: config.hideDeprecated });
    const serverUrl = config.serverUrl?.trim();
    if (!serverUrl) return filtered;
    const kind = detectKind(filtered);
    return kind ? applyServerOverride(filtered, kind, serverUrl) : filtered;
  }, [spec, config.includeTags, config.includePaths, config.hideDeprecated, config.serverUrl]);

  const samplesSource = useRef<{ spec: Record<string, unknown>; kind?: SpecKind }>({ spec: prepared });
  samplesSource.current.spec = prepared;
  samplesSource.current.kind = detectKind(prepared);
  const showSamples = config.showCodeSamples !== false;
  const plugins = useMemo(() => (showSamples ? [codeSamplesPlugin(samplesSource.current)] : []), [showSamples]);

  const requestInterceptor = useMemo(() => {
    const userFetch = proxyFetch(t, preview);
    return (req: Record<string, unknown>) => {
      const request = req as SwaggerRequest;
      request.userFetch = userFetch as SwaggerRequest['userFetch'];
      const token = pastedToken.current;
      if (token) {
        request.headers ??= {};
        if (!Object.keys(request.headers).some((k) => k.toLowerCase() === 'authorization')) request.headers.Authorization = `Bearer ${token}`;
      }
      return req;
    };
  }, [t, preview]);

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
      {needsTokenBar ? <TokenBar onChange={(token) => (pastedToken.current = token)} /> : null}
      <SwaggerUI
        // Plugins are only read when Swagger UI starts, so remount when samples are toggled.
        key={showSamples ? 'samples' : 'plain'}
        plugins={plugins}
        spec={prepared}
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
