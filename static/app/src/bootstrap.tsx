import { view } from '@forge/bridge';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';

/** Enable Confluence theming (light/dark) before the first render, then mount. */
export async function mount(app: ReactNode) {
  try {
    await view.theme.enable();
  } catch {
    // Theming is optional; fallbacks in base.css keep the UI readable.
  }
  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root element');
  createRoot(container).render(<StrictMode>{app}</StrictMode>);
}
