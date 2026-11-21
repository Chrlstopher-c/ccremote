// Responsabilité : les outils `modules` du serveur `lanterne` — lister les outils et intégrations des modules, appeler
// un outil (le relais le relaie à l'appli ouverte), afficher une intégration dans le fil. Les deux premiers passent par
// l'API du relais ; le troisième n'est qu'un événement du fil, rendu par l'interface.
import type { Logger } from 'pino';
import { depasseTailleDonnees } from '../../commun/modules.ts';
import { appeler, messageErreur, type Reponse } from './machines-outils.ts';
import type { ApiMachinesOutils } from './machines-outils.ts';
import { type ContexteOutils, echec, ok, protege, type Resultat } from './outils.ts';

export interface ArgsAppelModule {
  readonly module: string;
  readonly outil: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}

export interface ArgsAfficherModule {
  readonly module: string;
  readonly integration: string;
  readonly donnees: Readonly<Record<string, unknown>>;
  readonly titre?: string;
}

const RELAIS_INJOIGNABLE = 'relais injoignable : le module n’a pas pu être joint.';

/** Un appel au relais ; une panne réseau est journalisée et rendue `null`, jamais une exception. */
async function relais(
  api: ApiMachinesOutils,
  journal: Logger,
  operation: string,
  methode: string,
  chemin: string,
  corps?: unknown,
): Promise<Reponse | null> {
  try {
    return await appeler(api, methode, chemin, corps);
  } catch (erreur) {
    journal.error({ err: erreur, operation }, 'relais des modules injoignable');
    return null;
  }
}

export async function listerModules(api: ApiMachinesOutils, journal: Logger): Promise<Resultat> {
  const r = await relais(api, journal, 'liste des modules', 'GET', '/api/modules-outils');
  if (r === null) return { texte: RELAIS_INJOIGNABLE, erreur: true };
  return r.ok ? ok(JSON.stringify({ modules: r.corps })) : messageErreur(r);
}

export async function appelerModule(
  api: ApiMachinesOutils,
  journal: Logger,
  session: string,
  a: ArgsAppelModule,
): Promise<Resultat> {
  const corps = { module: a.module, outil: a.outil, arguments: a.arguments ?? {}, session };
  const r = await relais(api, journal, 'appel de module', 'POST', '/api/modules-appels', corps);
  if (r === null) return { texte: RELAIS_INJOIGNABLE, erreur: true };
  if (!r.ok) return messageErreur(r);
  const resultat = typeof r.corps === 'object' && r.corps !== null && 'resultat' in r.corps ? r.corps.resultat : null;
  return ok(JSON.stringify(resultat ?? null));
}

export function afficherModule(c: ContexteOutils, a: ArgsAfficherModule): Resultat {
  return protege(c, 'affichage de l’intégration', () => {
    if (depasseTailleDonnees(a.donnees)) return echec(c, 'données trop volumineuses (64 Ko au plus)');
    c.emettre({
      type: 'integration',
      module: a.module,
      integration: a.integration,
      donnees: a.donnees,
      ...(a.titre ? { titre: a.titre } : {}),
    });
    return ok(`Intégration « ${a.integration} » du module ${a.module} affichée.`);
  });
}
