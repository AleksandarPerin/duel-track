import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { App } from './App';
import { completePendingLogout } from './api/auth';
import { primeCsrfToken } from './api/client';
import { flushQueue } from './offline/syncQueue';

// Booting offline makes the priming fetch reject; ensureCsrfToken() retries
// it later regardless, so the boot-time call just needs to not surface an
// unhandled rejection for that expected case.
void primeCsrfToken().catch(() => {});
// A sign-out that couldn't reach the server while the page was navigating
// away (see logoutDuringNavigation) is finished here.
void completePendingLogout();

window.addEventListener('online', () => void flushQueue());
// Catches results queued while the tab was closed and the network came back
// in the meantime — the 'online' listener above can't fire for that case.
if (navigator.onLine) void flushQueue();
// A request that times out while the device still reports online gets
// queued (or, mid-flush, left 'pending') — and no 'online' event will ever
// come for it. Retry periodically and when the app returns to the
// foreground; flushQueue is cheap when nothing is pending and re-entrancy
// guarded.
window.setInterval(() => {
  if (navigator.onLine) void flushQueue();
}, 30_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navigator.onLine) void flushQueue();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
