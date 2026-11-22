// Responsabilité : les outils `reseau_*` des liaisons directes du serveur `lanterne` — relier un nœud à une adresse
// sans aiguilleur, choisir le transport d'un pair (adresse directe ou aiguilleur seul), régler l'écoute et les tunnels
// ssh, et lire la notice livrée (ressources/aide/reseau.md). Tout changement attend la confirmation de Chris.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { type ApiMachinesOutils, appeler, confirmer, messageErreur } from './machines-outils.ts';
import type { Resultat } from './outils.ts';

export const CHEMIN_AIDE_RESEAU = join(import.meta.dir, '..', '..', 'ressources', 'aide', 'reseau.md');
export const MEMBRE = z.string().regex(/^[a-f0-9]{12}$/);
export const ADRESSE = z.string().regex(/^[A-Za-z0-9._[\]:-]{3,120}$/);
const PORT = z.number().int().min(1).max(65535);

export const TUNNEL = z.object({
  hote: z.string().min(1).max(253),
  port: PORT,
  utilisateur: z.string().min(1).max(32),
  cle: z.string().min(2).max(400),
  portLocal: PORT,
  portDistant: PORT,
});

export const DESCRIPTION_AIDE =
  'Lire la notice des trois façons de relier ses machines (aiguilleur, adresse directe ou tunnel ssh, réseau ' +
  'local) et comment faire la même installation que Chris. À lire avant de répondre sur la liaison des machines.';

export const DESCRIPTION_AJOUTER_DIRECT =
  'Relier ce nœud à un autre nœud par son adresse, sans aiguilleur (réseau local, VPN, ou port local d’un tunnel ' +
  'ssh). ' +
  'Le pair présente son identité ; les deux empreintes s’affichent des deux côtés, et Chris accepte chez le visé. ' +
  '`adresse` : `hôte:port`, par exemple `192.168.1.20:47500` ou `127.0.0.1:47591` pour un tunnel.';

export const DESCRIPTION_TRANSPORT =
  'Choisir comment joindre un nœud déjà apparié : `adresse` (liaison directe, rétablie par ce nœud) ou `null` pour ' +
  'l’aiguilleur seul. Sans effet sur les sessions : seul le tuyau change.';

export const DESCRIPTION_DIRECTE =
  'Régler la liaison directe de ce nœud : `ecoute` (`hôte:port` où il accepte les pairs, `null` pour aucune), ' +
  '`proprietaire` (nom du réseau, identique sur chaque nœud), `tunnels` (tunnels ssh à monter et tenir vers des ' +
  'machines distantes, avec clé dédiée et known_hosts). N’envoyer que les champs à changer.';

const REFUS: Resultat = { texte: 'Chris n’a pas confirmé : rien n’a été fait.', erreur: false };

export async function aideReseau(log: Logger): Promise<Resultat> {
  try {
    return { texte: await readFile(CHEMIN_AIDE_RESEAU, 'utf8'), erreur: false };
  } catch (erreurLecture) {
    log.warn({ err: erreurLecture }, 'notice réseau illisible');
    return { texte: 'Notice réseau absente de cette version (ressources/aide/reseau.md manque).', erreur: true };
  }
}

export async function ajouterDirect(api: ApiMachinesOutils, adresse: string, log: Logger): Promise<Resultat> {
  const resume =
    `Relier ce nœud à « ${adresse} » sans aiguilleur : liaison directe, puis demande d’appairage. Les deux ` +
    'empreintes se comparent à voix haute ; Chris accepte chez le nœud visé.';
  if (!(await confirmer(api, 'appairer_direct', adresse, resume))) return REFUS;
  const r = await appeler(api, 'POST', '/api/federation/directe/appairer', { adresse });
  log.info({ ok: r.ok }, 'outil réseau : appairage direct');
  if (!r.ok) return messageErreur(r);
  return {
    texte:
      `Demande envoyée à « ${adresse} ». Les deux empreintes s’affichent sur les deux machines : les faire ` +
      'comparer à Chris, qui accepte chez le nœud visé.',
    erreur: false,
  };
}

export async function transportPair(
  api: ApiMachinesOutils,
  membre: string,
  adresse: string | null,
  log: Logger,
): Promise<Resultat> {
  const resume =
    adresse === null
      ? `Joindre « ${membre} » par l’aiguilleur seul (plus de liaison directe).`
      : `Joindre « ${membre} » directement à « ${adresse} » ; l’aiguilleur reste le repli.`;
  if (!(await confirmer(api, 'transport_pair', membre, resume))) return REFUS;
  const r = await appeler(api, 'POST', `/api/federation/pairs/${encodeURIComponent(membre)}/transport`, { adresse });
  log.info({ membre, ok: r.ok }, 'outil réseau : transport du pair');
  if (!r.ok) return messageErreur(r);
  return { texte: `Transport de « ${membre} » : ${adresse ?? 'aiguilleur seul'}.`, erreur: false };
}

export interface CorpsDirecte {
  readonly ecoute?: string | null;
  readonly proprietaire?: string | null;
  readonly tunnels?: z.infer<typeof TUNNEL>[];
}

export async function configurerDirecte(api: ApiMachinesOutils, corps: CorpsDirecte, log: Logger): Promise<Resultat> {
  const morceaux = [
    corps.ecoute !== undefined ? `écoute ${corps.ecoute ?? 'aucune'}` : null,
    corps.proprietaire ? `propriétaire « ${corps.proprietaire} »` : null,
    corps.tunnels ? `${corps.tunnels.length} tunnel(s) ssh` : null,
  ].filter((m): m is string => m !== null);
  const resume = `Liaison directe de ce nœud : ${morceaux.join(', ') || 'aucun changement'}.`;
  if (!(await confirmer(api, 'configurer_directe', 'directe', resume))) return REFUS;
  const r = await appeler(api, 'POST', '/api/federation/directe', corps);
  log.info({ ok: r.ok }, 'outil réseau : liaison directe réglée');
  return r.ok ? { texte: `Liaison directe réglée : ${morceaux.join(', ')}.`, erreur: false } : messageErreur(r);
}
