// Responsabilité : les alertes de fichier touché des deux côtés. Un outil d'écriture (Edit, Write, MultiEdit,
// NotebookEdit) dans une session locale et dans une session du pair, sur un même fichier relatif d'un projet partagé :
// une alerte, au plus une fois par fichier et par 30 min. Calculé sur ce relais, à partir des événements qui y passent.
import { type ConflitDuo, DUREE_CONFLIT_MS } from '../../commun/duo.ts';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Registre } from '../registre/registre.ts';
import type { PartagesDuo } from './partages.ts';

const OUTILS_ECRITURE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const REGEX_CHEMIN = /"(?:file_path|notebook_path)"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const CONFLITS_GARDES = 50;

interface Touche {
  readonly session: string;
  readonly pair: boolean;
  readonly quand: number;
}

export interface DependancesConflits {
  readonly registre: Registre;
  readonly partages: PartagesDuo;
  readonly diffusion: Diffusion;
  readonly horloge: () => number;
  readonly nomPair: () => string;
}

export class Conflits {
  private readonly touches = new Map<string, Touche[]>();
  private readonly alertes = new Map<string, number>();
  private readonly recents: ConflitDuo[] = [];

  constructor(private readonly d: DependancesConflits) {}

  /** Un événement de session (locale ou du pair) passe par ce relais ; seuls les outils d'écriture comptent. */
  observer(sessionId: string, evt: Evenement): void {
    if (evt.type !== 'outil' || !OUTILS_ECRITURE.has(evt.nom)) return;
    const fiche = this.d.registre.session(sessionId);
    if (!fiche || !this.projetPartage(fiche)) return;
    const fichier = fichierRelatif(fiche, evt.detail);
    if (fichier === null) return;
    this.toucher(sessionId, fiche, fichier);
  }

  lister(): ConflitDuo[] {
    return [...this.recents];
  }

  // Projet partagé : pour une session locale, le partage vise son projet ; pour une session du pair, un projet partagé
  // de même nom (le même projet vu des deux côtés).
  private projetPartage(fiche: ResumeSession): boolean {
    const projets = this.d.partages.lister().filter((p) => p.genre === 'projet');
    if (fiche.duo) return projets.some((p) => nomDuProjet(p.cible) === fiche.projet.nom);
    return projets.some((p) => p.cible === `${fiche.projet.machine}:${fiche.projet.chemin}`);
  }

  private toucher(sessionId: string, fiche: ResumeSession, fichier: string): void {
    const maintenant = this.d.horloge();
    const cle = `${fiche.projet.nom}\n${fichier}`;
    const pair = fiche.duo !== undefined;
    const vives = (this.touches.get(cle) ?? []).filter(
      (t) => maintenant - t.quand < DUREE_CONFLIT_MS && t.session !== sessionId,
    );
    const autre = vives.find((t) => t.pair !== pair);
    this.touches.set(cle, [...vives, { session: sessionId, pair, quand: maintenant }]);
    if (!autre) return;
    const [local, distant] = pair ? [autre.session, sessionId] : [sessionId, autre.session];
    this.alerter(cle, { projet: fiche.projet.nom, fichier, session: local, sessionPair: distant, maintenant });
  }

  private alerter(
    cle: string,
    a: { projet: string; fichier: string; session: string; sessionPair: string; maintenant: number },
  ): void {
    const dernier = this.alertes.get(cle);
    if (dernier !== undefined && a.maintenant - dernier < DUREE_CONFLIT_MS) return;
    this.alertes.set(cle, a.maintenant);
    const qui = this.d.nomPair();
    const conflit: ConflitDuo = {
      projet: a.projet,
      fichier: a.fichier,
      qui,
      session: a.session,
      sessionPair: a.sessionPair,
      le: new Date(a.maintenant).toISOString(),
    };
    this.recents.unshift(conflit);
    this.recents.splice(CONFLITS_GARDES);
    this.d.diffusion.diffuser({
      type: 'duo_conflit',
      projet: a.projet,
      fichier: a.fichier,
      qui,
      session: a.session,
      sessionPair: a.sessionPair,
    });
  }
}

function nomDuProjet(cible: string): string {
  const chemin = cible.slice(cible.indexOf(':') + 1);
  return chemin.split('/').filter(Boolean).pop() ?? chemin;
}

// Chemin du fichier relatif à la racine du projet ; null s'il est hors du projet ou absent du détail de l'outil.
function fichierRelatif(fiche: ResumeSession, detail: string): string | null {
  const trouve = REGEX_CHEMIN.exec(detail);
  if (!trouve?.[1]) return null;
  const chemin = trouve[1].replace(/\\(.)/g, '$1');
  const racine = fiche.projet.chemin.endsWith('/') ? fiche.projet.chemin : `${fiche.projet.chemin}/`;
  if (!chemin.startsWith(racine)) return null;
  const relatif = chemin.slice(racine.length);
  return relatif === '' ? null : relatif;
}
