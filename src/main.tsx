import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SinglePathApp } from './next/SinglePathApp';
import { AiSettingsProvider } from './services/AiSettings';
import './styles.css';
import './single-path.css';

createRoot(document.getElementById('root')!).render(<StrictMode><AiSettingsProvider><SinglePathApp /></AiSettingsProvider></StrictMode>);
