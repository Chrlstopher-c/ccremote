// Responsabilité : le bilan d'un tour SDK — totaux (compactions, contexte), fin de tour (état de la fiche puis suite
// donnée par la politique, comme le hook Stop d'une session tmux), compactions lancées, et le rythme (étapes, objectif,
// question) relayé par les outils MCP.
import type { Evenement, StatutSession } from '../../commun/session.ts';
import { CONSIGNE_COMPACTION } from './politique-compaction.ts';
import { effetRythme } from './rythme.ts';
import type { Suite } from './suite-du-tour.ts';
import type { SortieTraduction } from './traduction-sdk.ts';
import { emettre, maj, type NoyauSdk, pousser } from './session-sdk-noyau.ts';
import { ceder } from './session-sdk-rattachement.ts';

export function basculerAutonomie(n: NoyauSdk, active: boolean): void {
  n.bilan.reinitialiserRelances();
  maj(n, { autonomie: active });
}

export function constater(n: NoyauSdk, evt: Evenement): void {
  if (evt.type !== 'compaction') return;
  maj(n, { compactions: n.etat.compactions + 1, contexte: { ...n.etat.contexte, tokens: evt.apres } });
}

export function finDeTour(n: NoyauSdk, fin: NonNullable<SortieTraduction['finDeTour']>): void {
  const tokens = fin.contexte > 0 ? fin.contexte : n.etat.contexte.tokens;
  const suite = n.bilan.conclure({
    autonomie: n.etat.autonomie,
    aUnObjectif: n.etat.objectif !== null,
    contexte: tokens,
    maxTokens: n.etat.contexte.max,
    sousAgentsEnCours: n.registreTaches.sousAgentsEnCours(),
  });
  const panne = fin.erreur && !n.interrompuParChris;
  const statut: StatutSession = suite.action === 'laisser' ? 'travail' : panne ? 'erreur' : 'attente';
  maj(n, { statut, contexte: { ...n.etat.contexte, tokens } });
  if (n.cessionEnAttente) ceder(n);
  else appliquerSuite(n, suite);
  void n.suiviNuit.tick();
}

function appliquerSuite(n: NoyauSdk, suite: Suite): void {
  if (suite.action === 'laisser' || suite.action === 'patienter') return;
  if (suite.action === 'arreter') {
    if (suite.note) emettre(n, { type: 'relance', raison: suite.note });
    if (suite.statut !== 'attente') maj(n, { statut: suite.statut });
    return;
  }
  if (suite.action === 'compacter') {
    lancerCompaction(n, suite.raison);
    return;
  }
  emettre(n, { type: 'relance', raison: suite.raison });
  maj(n, { statut: 'travail' });
  pousser(n, suite.texte);
}

export function lancerCompaction(n: NoyauSdk, raison: string): void {
  n.bilan.compactionLancee();
  emettre(n, { type: 'relance', raison: `compaction : ${raison}` });
  maj(n, { statut: 'compaction' });
  pousser(n, CONSIGNE_COMPACTION);
}

// Les mêmes outils de rythme que tmux, servis par le même serveur MCP (voir serveurRythme).
export function rythme(n: NoyauSdk, outil: string, args: Record<string, unknown>): string {
  const effet = effetRythme(outil, args, n.etat.contexte);
  if (!effet) return `outil inconnu : ${outil}`;
  if (outil === 'etape_terminee') {
    n.bilan.etapeFaite();
    maj(n, { etapes: n.etat.etapes + 1 });
  } else if (outil === 'objectif_atteint') {
    n.bilan.marquerObjectif();
  } else {
    n.bilan.marquerQuestion();
  }
  emettre(n, effet.evenement);
  return effet.reponse;
}
