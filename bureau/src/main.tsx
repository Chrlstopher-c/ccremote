// Responsabilité : point d'entrée du webview — monte l'app.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import './index.css';

const racine = document.getElementById('racine');
if (racine)
  createRoot(racine).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
