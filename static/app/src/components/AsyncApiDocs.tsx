import AsyncApiComponent from '@asyncapi/react-component/lib/esm/without-parser';
import '@asyncapi/react-component/styles/default.min.css';
import '../styles/asyncapi-theme.css';
import type { MacroConfig } from '../../../../src/shared/types';

// Renders the parser's stringified document from the backend (see
// src/backend/asyncapi.ts). '@asyncapi/parser' is aliased to a parser-free
// shim in vite.config.ts so nothing here needs eval.
export default function AsyncApiDocs({ document, config }: { document: Record<string, unknown>; config: MacroConfig }) {
  return (
    <div className="sp-asyncapi">
      <AsyncApiComponent
        schema={document}
        config={{
          show: {
            sidebar: false,
            info: config.showInfo !== false,
            servers: config.showServers !== false,
            operations: true,
            messages: true,
            schemas: config.showModels !== false,
            errors: true,
          },
          expand: { messageExamples: false },
        }}
      />
    </div>
  );
}
