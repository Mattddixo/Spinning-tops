import { view } from '@forge/bridge';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';

export async function mount(app: ReactNode) {
  try {
    await view.theme.enable();
  } catch {
    // fine without it, base.css has fallbacks
  }
  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root element');
  createRoot(container).render(<StrictMode>{app}</StrictMode>);
}
