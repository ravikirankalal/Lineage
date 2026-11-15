import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Lineage needs the internet now, so there is no offline service worker. sw.js only removes the one
// older versions installed (and its cache), so nobody keeps seeing an outdated app.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.update()));
}

// Older versions kept a copy of the tree in this browser ('lineage', 'lineage-space-*'). The tree now
// lives only in the cloud, so remove those copies.
void (async () => {
  try {
    for (const d of (await indexedDB.databases?.()) ?? []) {
      if (d.name === 'lineage' || d.name?.startsWith('lineage-space-')) indexedDB.deleteDatabase(d.name);
    }
  } catch { /* not supported: nothing to clean */ }
})();

