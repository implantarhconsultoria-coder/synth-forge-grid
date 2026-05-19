import "./ai-factory-mobile-fix.css";
import "./lib/factory-settings";
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const MOBILE_CACHE_RESET_KEY = 'ai-factory-mobile-cache-reset-20260519-3';

async function clearLegacyMobileCache() {
  if (typeof window === 'undefined') return;

  const isPreview = window.location.hostname.includes('id-preview--') ||
                    window.location.hostname.includes('lovableproject.com');

  if (isPreview) return;
  if (window.sessionStorage.getItem(MOBILE_CACHE_RESET_KEY) === 'done') return;

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    }

    window.sessionStorage.setItem(MOBILE_CACHE_RESET_KEY, 'done');

    const url = new URL(window.location.href);
    if (url.searchParams.get('build') !== '20260519-3') {
      url.searchParams.set('build', '20260519-3');
      window.location.replace(url.toString());
    }
  } catch (error) {
    console.warn('Falha ao limpar cache antigo do mobile:', error);
  }
}

void clearLegacyMobileCache();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Elemento root não encontrado');

const root = ReactDOM.createRoot(rootElement);
root.render(<React.StrictMode><App /></React.StrictMode>);
