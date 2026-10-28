import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { seedPreferences } from './ui-preferences';
import '@fontsource/cascadia-mono/latin-400.css';
import '@fontsource/cascadia-mono/latin-ext-400.css';
import './cds/theme.css';
import './styles.css';

/** The stored sidebar width and last session must be in place before the first render reads them. */
async function boot(): Promise<void> {
  await seedPreferences();
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}

void boot();
