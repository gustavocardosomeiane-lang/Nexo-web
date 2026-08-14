import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/charts.css';
import './styles/app.css';
import './styles/responsive.css';
import './styles/nexo-ai.css';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento #root não encontrado.');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
