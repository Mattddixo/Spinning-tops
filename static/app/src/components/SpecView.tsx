import { lazy, Suspense } from 'react';
import { isAsyncApi } from '../../../../src/shared/spec';
import type { MacroConfig, SpecKind } from '../../../../src/shared/types';
import { ApiDocs } from './ApiDocs';
import { Loading } from './ui';

// The AsyncAPI renderer is large, so only pages that need it download it.
const AsyncApiDocs = lazy(() => import('./AsyncApiDocs'));

interface SpecViewProps {
  kind: SpecKind;
  spec: Record<string, unknown>;
  config: MacroConfig;
  tryItOutAllowed: boolean;
  preview?: MacroConfig;
}

export function SpecView({ kind, spec, config, tryItOutAllowed, preview }: SpecViewProps) {
  if (isAsyncApi(kind)) {
    return (
      <Suspense fallback={<Loading />}>
        <AsyncApiDocs document={spec} config={config} />
      </Suspense>
    );
  }
  return <ApiDocs spec={spec} config={config} tryItOutAllowed={tryItOutAllowed} preview={preview} />;
}
