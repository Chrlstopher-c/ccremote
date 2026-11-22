// Responsabilité : les outils `modules` du serveur `lanterne` — lister les outils et intégrations des modules, appeler
// un outil (le relais le relaie à l'appli ouverte), afficher une intégration dans le fil. Les deux premiers passent par
// le lien au relais (sans URL ni jeton) ; le troisième n'est qu'un événement du fil, rendu par l'interface.
import type { QuoiRelais, ReponseRelais } from '../../commun/modules.ts';
import { depasseTailleDonnees } from '../../commun/modules.ts';
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

const RELAIS_ABSENT = 'lien au relais indisponible : le module n’a pas pu être joint.';
const RELAIS_EN_ECHEC = 'requête au relais en échec';

/** Ce qu'il faut pour lister et appeler : le lien au relais et le journal (sans la session de présentation). */
export type LienModules = Pick<ContexteOutils, 'journal' | 'relais'>;

/** Requête au relais par le lien : absence ou exception deviennent un refus lisible, jamais une erreur qui tombe. */
async function demander(c: LienModules, quoi: QuoiRelais, args: unknown): Promise<ReponseRelais> {
  if (!c.relais) return { ok: false, erreur: RELAIS_ABSENT };
  try {
    return await c.relais(quoi, args);
  } catch (erreur) {
    c.journal.error({ err: erreur, operation: quoi }, RELAIS_EN_ECHEC);
    return { ok: false, erreur: RELAIS_EN_ECHEC };
  }
}

function refus(r: ReponseRelais): Resultat {
  return { texte: `Échec : ${r.erreur ?? 'erreur inconnue'}`, erreur: true };
}

// La route HTTP du relais rend `{ resultat }` en succès : c'est le résultat de l'outil qui revient à l'agent.
function resultatDe(donnees: unknown): unknown {
  return typeof donnees === 'object' && donnees !== null && 'resultat' in donnees ? (donnees.resultat ?? null) : null;
}

export async function listerModules(c: LienModules): Promise<Resultat> {
  const r = await demander(c, 'modules_lister', {});
  return r.ok ? ok(JSON.stringify({ modules: r.donnees })) : refus(r);
}

export function appelerModule(c: ContexteOutils, a: ArgsAppelModule): Promise<Resultat> {
  return appelerPour(c, a, c.sessionId);
}

/** Appel depuis une session hors de Lanterne : aucune session n'est connue du poste, donc `session: null`. */
export function appelerHorsSession(c: LienModules, a: ArgsAppelModule): Promise<Resultat> {
  return appelerPour(c, a, null);
}

async function appelerPour(c: LienModules, a: ArgsAppelModule, session: string | null): Promise<Resultat> {
  const args = { module: a.module, outil: a.outil, arguments: a.arguments ?? {}, session };
  const r = await demander(c, 'module_appeler', args);
  return r.ok ? ok(JSON.stringify(resultatDe(r.donnees))) : refus(r);
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
