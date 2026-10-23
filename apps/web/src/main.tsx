import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/prototype.css';
import './styles/app.css';
import './styles/tenant-theme.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Root element #root not found in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
