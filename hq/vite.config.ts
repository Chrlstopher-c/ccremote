// Responsabilité : la configuration Vite d'Agent HQ — base du build (/hq/), et proxy de dev optionnel vers le relais.
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const cible = env.RELAIS_CIBLE?.trim() ?? '';
  return {
    base: command === 'build' ? '/hq/' : '/',
    server: cible
      ? { proxy: { '/api': { target: cible, changeOrigin: true, ws: true } } }
      : {},
  };
});
