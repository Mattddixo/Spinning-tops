import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { AppError } from '../../../../src/shared/types';
import { errorText, useT } from '../i18n';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  appearance?: 'default' | 'primary' | 'subtle' | 'danger';
  compact?: boolean;
};

export function Button({ appearance = 'default', compact, className, type = 'button', ...rest }: ButtonProps) {
  const classes = ['sp-button', appearance !== 'default' && `sp-button-${appearance}`, compact && 'sp-button-compact', className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest} />;
}

export function Field({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: ReactNode;
  error?: string;
  children: (id: string, describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const helpId = help || error ? `${id}-help` : undefined;
  return (
    <div className="sp-field">
      <label className="sp-label" htmlFor={id}>
        {label}
      </label>
      {children(id, helpId)}
      {error ? (
        <span id={helpId} className="sp-error-text" role="alert">
          {error}
        </span>
      ) : help ? (
        <span id={helpId} className="sp-help">
          {help}
        </span>
      ) : null}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  help,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  help?: ReactNode;
}) {
  return (
    <div className="sp-stack-tight">
      <label className="sp-toggle">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="sp-toggle-track" aria-hidden="true" />
        <span>{label}</span>
      </label>
      {help ? <span className="sp-help">{help}</span> : null}
    </div>
  );
}

const ICONS = { info: 'i', warning: '!', error: '!', success: '✓' } as const;

export function Message({
  appearance = 'info',
  title,
  children,
  actions,
}: {
  appearance?: keyof typeof ICONS;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={`sp-message sp-message-${appearance}`} role={appearance === 'error' ? 'alert' : 'status'}>
      <span className="sp-message-icon" aria-hidden="true">
        {ICONS[appearance]}
      </span>
      <div className="sp-message-body">
        {title ? <strong>{title}</strong> : null}
        {children}
        {actions ? <div className="sp-row">{actions}</div> : null}
      </div>
    </div>
  );
}

export function ErrorMessage({ error, actions }: { error: AppError; actions?: ReactNode }) {
  const t = useT();
  const appearance = error.code === 'NOT_CONFIGURED' ? 'info' : error.code === 'EGRESS_NOT_APPROVED' || error.code === 'SOURCE_DISABLED' ? 'warning' : 'error';
  const { title, hint } = errorText(t, error);
  return (
    <Message appearance={appearance} title={title} actions={actions}>
      {hint ? <span>{hint}</span> : null}
      {error.detail ? <span className="sp-muted">{error.detail}</span> : null}
    </Message>
  );
}

export function Loading({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="sp-loading" role="status" aria-live="polite">
      <span className="sp-spinner" aria-hidden="true" />
      <span>{label ?? t('ui.common.loading')}</span>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="sp-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="sp-tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Split a comma- or newline-separated list typed into a text field. */
export const splitList = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
