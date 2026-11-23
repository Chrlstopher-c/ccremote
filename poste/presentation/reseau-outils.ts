// Responsabilité : les outils `reseau_*` du serveur `lanterne` — un agent guide Chris pour ajouter une machine au
// réseau (installation du nœud par SSH, empreintes comparées, accord, reprise d'attribution) et peut revenir en
// arrière. Tout geste qui change le parc attend la confirmation de Chris dans l'appli ; l'accord d'appairage aussi.
import type { Logger } from 'pino';
import type { VueAjout } from '../../commun/ajout-noeud.ts';
import { type ApiMachinesOutils, appeler, confirmer, messageErreur } from './machines-outils.ts';
import type { Resultat } from './outils.ts';

export const DESCRIPTION_AJOUTER =
  'Ajouter une machine de l’utilisateur au réseau Lanterne (tour, VPS…) : installe son nœud par SSH, le relie à l’aiguilleur ' +
  'avec un code à usage unique et demande l’appairage chiffré avec cette machine. Machine déjà configurée dans ' +
  'Paramètres › Machines (ex. « tour ») : donner seulement `machine` (son identifiant, gardé : ses sessions gardent ' +
  'leur badge, leurs titres, catégories et épinglages) et `nom`. Machine neuve : ajouter `hote`, `utilisateur`, ' +
  '`cle` (chemin de la clé SSH sur cette machine), `port`. Avant d’appeler : demander à l’utilisateur l’identifiant, le nom ' +
  'et, pour une machine neuve, son accès SSH. L’utilisateur confirme dans l’appli. Ensuite : `reseau_suivre_ajout` ' +
  'jusqu’à « accord attendu ». Procédure complète : recherche/AJOUTER-UNE-MACHINE.md du dépôt Lanterne.';

export const DESCRIPTION_SUIVRE =
  'Avancement des ajouts de machine au réseau (étape, état, empreintes, reprise des sessions) et ce qu’il faut faire ' +
  'ensuite. À rappeler toutes les 10 à 20 s pendant un ajout.';

export const DESCRIPTION_ACCEPTER =
  'Accepter l’appairage d’une machine en cours d’ajout, seulement quand `reseau_suivre_ajout` dit « accord attendu » ' +
  'avec des empreintes identiques. Lire d’abord les empreintes à l’utilisateur ; il confirme dans l’appli.';

export const DESCRIPTION_RETOUR =
  'Revenir en arrière sur l’ajout d’une machine : son nœud s’arrête, son ancien poste redémarre (mêmes sessions), la ' +
  'machine est révoquée du réseau ici. L’utilisateur confirme dans l’appli.';

export interface ArgsAjout {
  readonly machine: string;
  readonly nom: string;
  readonly hote?: string | undefined;
  readonly port?: number | undefined;
  readonly utilisateur?: string | undefined;
  readonly cle?: string | undefined;
}

const REFUS: Resultat = { texte: 'L’utilisateur n’a pas confirmé : rien n’a été fait.', erreur: false };

function corpsAjout(a: ArgsAjout): Record<string, unknown> {
  const complet = a.hote && a.utilisateur && a.cle;
  const ssh = complet ? { hote: a.hote, port: a.port ?? 22, utilisateur: a.utilisateur, cle: a.cle } : null;
  return { machine: a.machine, nom: a.nom, ...(ssh ? { ssh } : {}) };
}

export async function ajouterAuReseau(api: ApiMachinesOutils, a: ArgsAjout, log: Logger): Promise<Resultat> {
  const neuve = a.hote ? `machine neuve, accès SSH ${a.utilisateur ?? '?'}@${a.hote}` : 'machine déjà configurée';
  const resume = `Ajouter « ${a.nom} » (${a.machine}) au réseau Lanterne : ${neuve}. Son poste actuel est basculé sur son nœud.`;
  if (!(await confirmer(api, 'ajouter_machine_reseau', a.machine, resume))) return REFUS;
  const r = await appeler(api, 'POST', '/api/reseau/ajouts', corpsAjout(a));
  log.info({ machine: a.machine, ok: r.ok }, 'outil réseau : ajout lancé');
  if (!r.ok) return messageErreur(r);
  return { texte: `Ajout lancé. Suivre avec reseau_suivre_ajout.\n${texteVue(r.corps as VueAjout)}`, erreur: false };
}

export async function suivreAjouts(api: ApiMachinesOutils): Promise<Resultat> {
  const r = await appeler(api, 'GET', '/api/reseau/ajouts');
  if (!r.ok) return messageErreur(r);
  const vues = r.corps as VueAjout[];
  if (vues.length === 0) return { texte: 'Aucun ajout de machine depuis le démarrage du moteur.', erreur: false };
  return { texte: vues.map(texteVue).join('\n\n'), erreur: false };
}

export async function accepterAjout(api: ApiMachinesOutils, machine: string, log: Logger): Promise<Resultat> {
  const r = await appeler(api, 'GET', '/api/reseau/ajouts');
  if (!r.ok) return messageErreur(r);
  const vue = (r.corps as VueAjout[]).find((v) => v.machine === machine);
  if (!vue || vue.etat !== 'accord_attendu' || vue.concordance !== 'identique') {
    return { texte: 'Aucun accord attendu avec des empreintes identiques pour cette machine.', erreur: true };
  }
  const resume = `Accepter l’appairage de « ${vue.nom} ». Empreinte lue par SSH et reçue par l’aiguilleur : ${vue.empreinteSsh}.`;
  if (!(await confirmer(api, 'accepter_appairage', machine, resume))) return REFUS;
  const a = await appeler(api, 'POST', `/api/reseau/ajouts/${encodeURIComponent(machine)}/accepter`);
  log.info({ machine, ok: a.ok }, 'outil réseau : appairage accepté');
  if (!a.ok) return messageErreur(a);
  return { texte: 'Appairage accepté : le lien chiffré s’ouvre, puis la reprise des sessions.', erreur: false };
}

export async function retourArriere(api: ApiMachinesOutils, machine: string, log: Logger): Promise<Resultat> {
  const resume = `Revenir en arrière sur « ${machine} » : nœud arrêté, ancien poste redémarré, machine révoquée du réseau.`;
  if (!(await confirmer(api, 'retour_arriere_reseau', machine, resume))) return REFUS;
  const r = await appeler(api, 'POST', `/api/reseau/ajouts/${encodeURIComponent(machine)}/retour`);
  log.info({ machine, ok: r.ok }, 'outil réseau : retour arrière');
  return r.ok ? { texte: `Retour arrière fait pour « ${machine} ».`, erreur: false } : messageErreur(r);
}

const SUITE: Record<VueAjout['etat'], string> = {
  en_cours: 'Patienter puis rappeler reseau_suivre_ajout.',
  accord_attendu:
    'Lire les empreintes à l’utilisateur : il les voit aussi dans Paramètres › Réseau. Identiques : reseau_accepter_ajout.',
  fini: 'Vérifier avec l’utilisateur : la machine « lien chiffré » dans Paramètres › Réseau, ses sessions sous le même badge.',
  echec: 'Lire le message ; corriger ; relancer reseau_ajouter_machine (sans risque) ou reseau_retour_arriere.',
  retire: 'Nœud arrêté, ancien poste rétabli.',
};

export function texteVue(v: VueAjout): string {
  const lignes = [`${v.nom} (${v.machine}) : étape ${v.etape}, ${v.etat}${v.message ? ` — ${v.message}` : ''}`];
  if (v.empreinteSsh) lignes.push(`Empreinte du nœud (SSH) : ${v.empreinteSsh}`);
  if (v.empreinteDemande) lignes.push(`Empreinte reçue par l’aiguilleur : ${v.empreinteDemande}`);
  if (v.concordance) lignes.push(`Concordance : ${v.concordance}`);
  lignes.push(`Ensuite : ${SUITE[v.etat]}`);
  return lignes.join('\n');
}
