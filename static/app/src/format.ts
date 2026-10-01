import type { SpecKind } from '../../../src/shared/types';

export const KIND_LABELS: Record<SpecKind, string> = {
  'openapi-3.0': 'OpenAPI 3.0',
  'openapi-3.1': 'OpenAPI 3.1',
  'openapi-3.2': 'OpenAPI 3.2',
  'swagger-2.0': 'Swagger 2.0',
};

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'openapi'
  );
}

/** Trigger a file download from the sandboxed iframe (allowed on user gesture). */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
