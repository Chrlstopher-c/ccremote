// Responsabilité : le journal de l'app (pino, sortie console du webview).
import pino from 'pino';

export const journal = pino({ name: 'ccremote-bureau', level: import.meta.env.DEV ? 'debug' : 'info', browser: { asObject: false } });
