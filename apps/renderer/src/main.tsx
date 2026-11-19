import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app.tsx';
import { startLive } from './lib/live.ts';
import './styles.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('index.html is missing #root');
}

startLive();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
