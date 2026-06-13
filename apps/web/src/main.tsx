import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import '@fables/ui/styles.css';
import './index.css';
import { hydrateIfStale } from './offline/hydration.js';
import { scheduleJournalReminder } from './notifications/notificationStore.js';

// Start background hydration (F822) — non-blocking.
void hydrateIfStale();

// Schedule journal reminder (F872) on app load.
scheduleJournalReminder();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
