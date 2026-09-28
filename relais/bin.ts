// Responsabilité : point d'entrée du relais — deux serveurs : clients (web, iPhone) et postes (machines de travail).
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { creerJournal } from '../commun/journal.ts';
import { CHEMIN_POSTE } from '../commun/protocole-poste.ts';
import { Acces } from './acces/acces.ts';
import { construireRoutes } from './clients/api.ts';
import { ApiSessions } from './clients/api-sessions.ts';
import { Diffusion } from './clients/diffusion.ts';
import { erreur } from './clients/http.ts';
import { chargerConfig } from './config.ts';
import { type DonneesPoste, Postes } from './parc/postes.ts';
import { ouvrirBase } from './registre/base.ts';
import { Registre } from './registre/registre.ts';

const journal = creerJournal('relais');
const config = chargerConfig();
const registre = new Registre(ouvrirBase(config.base));
const diffusion = new Diffusion();
const acces = new Acces(registre, config.empreinteMotDePasse);
const postes = new Postes(registre, diffusion, config.secretsPostes, journal);
const sessions = new ApiSessions(registre, postes, diffusion, config.isolees);
const routes = construireRoutes({ acces, registre, postes, diffusion, sessions, wol: config.wol, diffusionWol: config.diffusionWol });

function fichierStatique(req: Request): Response {
  const chemin = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, '');
  const cible = join(config.web, chemin);
  if (cible.startsWith(config.web) && existsSync(cible) && !cible.endsWith('/')) {
    const immuable = chemin.startsWith('/assets/');
    return new Response(Bun.file(cible), { headers: immuable ? { 'cache-control': 'public, max-age=31536000, immutable' } : {} });
  }
  const index = join(config.web, 'index.html');
  return existsSync(index) ? new Response(Bun.file(index)) : new Response('interface non construite', { status: 503 });
}

Bun.serve({
  port: config.portWeb,
  routes: {
    ...routes,
    '/api/flux': (req, serveur) => {
      if (!acces.autorise(req)) return erreur('non connecté', 401);
      return serveur.upgrade(req, { data: {} }) ? undefined : erreur('WebSocket attendu', 426);
    },
    '/api/*': () => erreur('route inconnue', 404),
  },
  fetch: fichierStatique,
  websocket: {
    data: {} as Record<string, never>,
    open: (ws) => diffusion.ajouter(ws),
    close: (ws) => diffusion.retirer(ws),
    message: () => undefined, // les clients écoutent ; ils agissent par l'API HTTP
    idleTimeout: 120,
    sendPings: true,
  },
});

Bun.serve({
  port: config.portPostes,
  fetch(req, serveur) {
    if (new URL(req.url).pathname !== CHEMIN_POSTE) return new Response('introuvable', { status: 404 });
    const machine = postes.authentifier(req);
    if (!machine) {
      journal.warn({ machine: req.headers.get('x-ccremote-machine') }, 'poste refusé : secret invalide');
      return new Response('refusé', { status: 401 });
    }
    return serveur.upgrade(req, { data: { machine } }) ? undefined : new Response('WebSocket attendu', { status: 426 });
  },
  websocket: {
    data: {} as DonneesPoste,
    open: (ws) => postes.ouvert(ws),
    close: (ws) => postes.ferme(ws),
    message: (ws, m) => postes.recu(ws, String(m)),
    idleTimeout: 120,
    sendPings: true,
    maxPayloadLength: 8 * 1024 * 1024,
  },
});

journal.info({ web: config.portWeb, postes: config.portPostes, machinesAutorisees: [...config.secretsPostes.keys()] }, 'relais démarré');
