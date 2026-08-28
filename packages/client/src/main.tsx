import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { App } from './App';
import { primeCsrfToken } from './api/client';
import { flushQueue } from './offline/syncQueue';

// Booting offline makes the priming fetch reject; ensureCsrfToken() retries
// it later regardless, so the boot-time call just needs to not surface an
// unhandled rejection for that expected case.
void primeCsrfToken().catch(() => {});

window.addEventListener('online', () => void flushQueue());
// Catches results queued while the tab was closed and the network came back
// in the meantime — the 'online' listener above can't fire for that case.
if (navigator.onLine) void flushQueue();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
