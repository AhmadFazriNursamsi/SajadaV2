import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { SessionProvider } from './session';
import { ToastProvider } from './ui';
import './styles.css';

// Alat anotasi UI (agentation.com): hanya di mode dev, tidak masuk build produksi.
// Set VITE_AGENTATION_ENDPOINT=http://localhost:4747 bila server MCP-nya berjalan.
const Agentation = import.meta.env.DEV
  ? lazy(() => import('agentation').then((m) => ({ default: () => <m.Agentation endpoint={import.meta.env.VITE_AGENTATION_ENDPOINT as string | undefined} /> })))
  : null;

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ToastProvider>
          <SessionProvider><App /></SessionProvider>
          {Agentation && <Suspense fallback={null}><Agentation /></Suspense>}
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
