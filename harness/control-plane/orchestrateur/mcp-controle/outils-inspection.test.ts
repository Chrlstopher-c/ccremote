import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import type { InterrogateurGit } from '../../../projets/index.ts';
import {
  etatEquipe,
  historiqueEquipe,
  listerEquipes,
  listerProjets,
  rapportEquipe,
  REFUS_AUTRE_FIL,
  resoudreMission,
  suivreEquipe,
  suivreEquipes,
  transcriptEquipe,
} from './outils-inspection.ts';

const GIT_FACTICE_NON_GIT: InterrogateurGit = {
  estDepotGit: async () => false,
  existeBranche: async () => false,
  aTravailNonCommite: async () => false,
};

let registre: Registre;
let repertoireProjets: string;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-compte1' });
  registre.lots.creer({ id: 'lot-1', intention: 'corriger le login' });
  repertoireProjets = mkdtempSync(join(tmpdir(), 'mcp-controle-projets-'));
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoireProjets, { recursive: true, force: true });
});

describe('outils-inspection (A.2.2, groupe lecture seule)', () => {
  test('lister_equipes : aucune équipe active', () => {
    const resultat = listerEquipes(registre);
    expect(resultat.ok).toBe(true);
    expect(resultat.effet).toBe('applique');
    expect(resultat.etat).toContain('aucune équipe active');
  });

  test('lister_equipes : résumé sans flux brut (H-45)', () => {
    registre.missions.creer({ id: 'm-1', lotId: 'lot-1', nom: 'refaire auth', projet: 'alpha', compteId: 'compte1' });
    const resultat = listerEquipes(registre);
    expect(resultat.etat).toContain('m-1');
    expect(resultat.etat).toContain('harness=planifiee');
  });

  test('etat_equipe : mission introuvable ⇒ refus explicite, pas d’exception', () => {
    const resultat = etatEquipe(registre, null, 'inconnue');
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('aucune équipe');
  });

  test('☠ lister_equipes montre aussi les équipes TERMINÉES (23/07)', () => {
    registre.missions.creer({ id: 'm-viv', lotId: 'lot-1', nom: 'en cours', projet: 'alpha', compteId: 'compte1' });
    registre.missions.creer({ id: 'm-fin', lotId: 'lot-1', nom: 'finie', projet: 'beta', compteId: 'compte1' });
    registre.etats.appliquerEtatHarness('m-fin', 'terminee');
    const resultat = listerEquipes(registre);
    expect(resultat.etat).toContain('m-viv');
    // Sans ce rendu, l'orchestrateur répondait « introuvable » sur une équipe
    // que l'opérateur venait de voir se terminer.
    expect(resultat.etat).toContain('m-fin');
    expect(resultat.etat).toContain('terminées');
  });

  test('☠ etat_equipe accepte le NOM, pas seulement l’identifiant (23/07)', () => {
    registre.missions.creer({ id: 'm-3', lotId: 'lot-1', nom: 'refonte panier', projet: 'vela', compteId: 'compte1' });
    expect(etatEquipe(registre, null, 'refonte panier').ok).toBe(true);
    expect(etatEquipe(registre, null, 'vela').ok).toBe(true);
    // Fragment : ce que l'opérateur retient réellement d'un nom.
    expect(etatEquipe(registre, null, 'panier').ok).toBe(true);
  });

  test('etat_equipe : désignation ambiguë ⇒ refus qui liste les candidats, jamais un choix au hasard', () => {
    registre.missions.creer({ id: 'm-a', lotId: 'lot-1', nom: 'refonte panier', projet: 'vela', compteId: 'compte1' });
    registre.missions.creer({ id: 'm-b', lotId: 'lot-1', nom: 'refonte compte', projet: 'lattice', compteId: 'compte1' });
    const resultat = etatEquipe(registre, null, 'refonte');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('ambiguë');
    expect(resultat.raison).toContain('m-a');
    expect(resultat.raison).toContain('m-b');
  });

  test('etat_equipe : détail budget/contexte/capacités', () => {
    registre.missions.creer({
      id: 'm-2',
      lotId: 'lot-1',
      nom: 'refaire auth',
      projet: 'alpha',
      compteId: 'compte1',
      budgetMaxUsd: 100,
    });
    const resultat = etatEquipe(registre, null, 'm-2');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('budget=0/100');
    expect(resultat.etat).toContain('capacités surveillées toutes présentes');
  });

  // `☠` 03/08 : interrogé sur les sous-agents d'une équipe en vol, l'orchestrateur
  // a répondu « il n'y a aucun champ sous-agents, ni 3 ni aucun ». Il ne pouvait
  // ni les compter, ni conclure qu'il n'y en avait pas — la seule information qui
  // distingue une équipe qui travaille d'une équipe qui attend.
  test('etat_equipe : compte les sous-agents, et dit combien sont actifs', () => {
    registre.missions.creer({ id: 'm-sa', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    registre.missions.poserSousAgents('m-sa', [
      { agentId: 'a1', type: 'general-purpose', description: 'ALPHA', toolUseId: null, profondeur: 1, statut: 'actif', derniereAction: 'ALPHA', majA: Date.now() },
      { agentId: 'a2', type: 'general-purpose', description: 'BRAVO', toolUseId: null, profondeur: 1, statut: 'termine', derniereAction: 'BRAVO', majA: Date.now() },
    ]);
    expect(etatEquipe(registre, null, 'm-sa').etat).toContain('sous-agents=2 (1 actif)');
  });

  test('☠ équipe CLOSE ⇒ aucun sous-agent annoncé en cours, même si le dernier relevé disait « actif »', () => {
    // Relevé par l'orchestrateur : « sous-agents=3 (2 actifs) » sur une équipe
    // terminée. Le statut vient du silence sur disque, donc du dernier relevé,
    // qui date d'avant la clôture. Restituer cet instantané refait la panne du
    // 02/08 dans l'autre sens : un état posé une fois, jamais redérivé.
    registre.missions.creer({ id: 'm-close', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    registre.missions.poserSousAgents('m-close', [
      { agentId: 'a1', type: 'general-purpose', description: 'ALPHA', toolUseId: null, profondeur: 1, statut: 'actif', derniereAction: 'ALPHA', majA: Date.now() },
    ]);
    registre.etats.appliquerEtatHarness('m-close', 'terminee');
    const etat = etatEquipe(registre, null, 'm-close').etat ?? '';
    expect(etat).toContain('sous-agents=1 (équipe close, aucun en cours)');
    expect(etat).not.toContain('actif');
  });

  test('etat_equipe : aucun sous-agent ⇒ « aucun observé », jamais un silence', () => {
    registre.missions.creer({ id: 'm-seul', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    expect(etatEquipe(registre, null, 'm-seul').etat).toContain('sous-agents=aucun observé');
  });

  test('lister_projets : répertoire vide ⇒ dit ce qui est vide, et vers quoi se tourner', async () => {
    const resultat = await listerProjets(repertoireProjets, GIT_FACTICE_NON_GIT);
    expect(resultat.ok).toBe(true);
    // `☠` 03/08 : « aucun projet valide » se lisait « il n'y a pas de projets »,
    // alors qu'explorer_projets voyait trois dépôts — l'orchestrateur a relevé
    // l'incohérence comme un défaut. Le vide doit dire QUEL registre est vide,
    // et où sont les vrais projets.
    expect(resultat.etat).toContain('aucun projet DÉCLARÉ');
    expect(resultat.etat).toContain(repertoireProjets);
    expect(resultat.etat).toContain('explorer_projets');
  });

  test('lister_projets : fichier invalide rejeté, jamais une exception', async () => {
    writeFileSync(join(repertoireProjets, 'casse.json'), JSON.stringify({ id: 'x' }));
    const resultat = await listerProjets(repertoireProjets, GIT_FACTICE_NON_GIT);
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('rejetés');
  });

  test('☠ lister_projets : répertoire illisible ⇒ ok:false, jamais de rejet vers l’appelant', async () => {
    const inexistant = join(repertoireProjets, 'nexiste-pas');
    const resultat = await listerProjets(inexistant, GIT_FACTICE_NON_GIT);
    // chargerProjets absorbe déjà le répertoire illisible en interne (retourne []) —
    // le contrat de ce module reste donc ok:true, aucune exception ne remonte.
    expect(resultat.ok).toBe(true);
  });

  test('historique_equipe : aucune transition connue', () => {
    registre.missions.creer({ id: 'm-3', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    const resultat = historiqueEquipe(registre, null, 'm-3');
    expect(resultat.etat).toBe('aucune transition connue');
  });

  test('historique_equipe : résume origine/motif d’une transition', () => {
    registre.missions.creer({ id: 'm-4', lotId: 'lot-1', nom: 'x', projet: 'alpha', compteId: 'compte1' });
    registre.etats.appliquerEtatHarness('m-4', 'en_cours', { motif: 'dispatch initial' });
    const resultat = historiqueEquipe(registre, null, 'm-4');
    expect(resultat.etat).toContain('[harness] planifiee → en_cours (dispatch initial)');
  });

});

describe('rapport_equipe — ce que l’équipe a écrit', () => {
  test('☠ rend les textes produits, pas seulement les compteurs (23/07)', () => {
    registre.missions.creer({ id: 'm-r', lotId: 'lot-1', nom: 'vela', projet: 'vela', compteId: 'compte1' });
    registre.missions.ajouterActivite('m-r', 'Premier constat.', 1_000);
    registre.missions.ajouterActivite('m-r', 'Rapport final : tout compile.', 2_000);
    const resultat = rapportEquipe(registre, null, 'vela');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('Rapport final');
  });

  test('aucune activité rapatriée ⇒ le dit, sans prétendre que l’équipe n’a rien fait', () => {
    registre.missions.creer({ id: 'm-v', lotId: 'lot-1', nom: 'vide', projet: 'lattice', compteId: 'compte1' });
    const resultat = rapportEquipe(registre, null, 'lattice');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('aucun texte produit');
  });

  test('☠ rend le dernier texte ENTIER, jamais tronqué (décision opérateur 23/07)', () => {
    registre.missions.creer({ id: 'm-n', lotId: 'lot-1', nom: 'long', projet: 'aegis', compteId: 'compte1' });
    const synthese = `SYNTHÈSE\n${'détail '.repeat(2_000)}FIN`;
    registre.missions.ajouterActivite('m-n', synthese, 9_000);
    const resultat = rapportEquipe(registre, null, 'aegis');
    // Une synthèse coupée en son milieu ne vaut rien : le début ET la fin doivent survivre.
    expect(resultat.etat).toContain('SYNTHÈSE');
    expect(resultat.etat).toContain('FIN');
    expect((resultat.etat ?? '').length).toBe(synthese.length);
  });

  test('☠ réflexions et appels d’outils ne sont JAMAIS pris pour le rapport', () => {
    registre.missions.creer({ id: 'm-t', lotId: 'lot-1', nom: 'mixte', projet: 'flux', compteId: 'compte1' });
    registre.missions.ajouterActivite('m-t', 'la vraie synthèse', 1_000, 'texte');
    registre.missions.ajouterActivite('m-t', 'je me demande si…', 2_000, 'reflexion');
    registre.missions.ajouterActivite('m-t', 'pattern=TODO', 3_000, 'outil', 'Grep');
    // Le dernier ÉVÉNEMENT est un outil ; le dernier TEXTE reste la synthèse.
    expect(rapportEquipe(registre, null, 'flux').etat).toBe('la vraie synthèse');
  });
});

describe('transcript_equipe — la fin d’un transcript, en un seul appel (chantier 1, 21/08)', () => {
  function semer(id: string, projet: string, n = 12): void {
    registre.missions.creer({ id, lotId: 'lot-1', nom: id, projet, compteId: 'compte1' });
    for (let i = 0; i < n; i += 1) {
      registre.missions.ajouterActivite(id, `activité ${i}`, 1_000 + i, i % 4 === 0 ? 'outil' : 'texte');
    }
  }

  test('☠ par défaut, rend déjà la FIN — le geste n°1 : une équipe sans rapport', () => {
    semer('m-tx1', 'transcript-1');
    const resultat = transcriptEquipe(registre, null, 'transcript-1');
    expect(resultat.ok).toBe(true);
    // Les 12 dernières activités tiennent sous la limite par défaut (50) : tout y est,
    // dans l'ordre chronologique — la plus ancienne d'abord, la plus récente en dernier.
    expect(resultat.etat).toContain('activité 0');
    expect((resultat.etat ?? '').indexOf('activité 0')).toBeLessThan((resultat.etat ?? '').indexOf('activité 11'));
  });

  test('borne la page à `limite`, et dit ce qu’il reste plus ancien', () => {
    semer('m-tx2', 'transcript-2');
    const resultat = transcriptEquipe(registre, null, 'transcript-2', { limite: 3 });
    expect(resultat.etat).toContain('3 ligne(s) sur 12 au total');
    expect(resultat.etat).toContain('+9 plus ancienne(s)');
    // decalage=0 par défaut ⇒ les 3 DERNIÈRES, pas les 3 premières.
    expect(resultat.etat).toContain('activité 11');
    expect(resultat.etat).not.toContain('activité 0\n');
  });

  test('decalage remonte le temps sans repasser par le début', () => {
    semer('m-tx3', 'transcript-3');
    const fin = transcriptEquipe(registre, null, 'transcript-3', { limite: 3, decalage: 0 });
    const avant = transcriptEquipe(registre, null, 'transcript-3', { limite: 3, decalage: 3 });
    expect(fin.etat).toContain('activité 11');
    expect(avant.etat).toContain('activité 8');
    expect(avant.etat).not.toContain('activité 11');
  });

  test('filtre par type : ne garde que les appels d’outils', () => {
    semer('m-tx4', 'transcript-4');
    const resultat = transcriptEquipe(registre, null, 'transcript-4', { type: 'outil', limite: 50 });
    expect(resultat.etat).toContain('3 ligne(s) sur 3 au total'); // i = 0, 4, 8
    expect(resultat.etat).not.toContain('activité 1\n');
  });

  test('équipe sans aucune activité : le dit, sans exception', () => {
    registre.missions.creer({ id: 'm-tx5', lotId: 'lot-1', nom: 'vide', projet: 'transcript-5', compteId: 'compte1' });
    const resultat = transcriptEquipe(registre, null, 'transcript-5');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('aucune activité');
  });

  test('équipe introuvable : refus nommé, jamais un transcript vide', () => {
    const resultat = transcriptEquipe(registre, null, 'fantome-inexistant');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toContain('aucune équipe');
  });
});

/**
 * `☠` `creer_equipe` rend DEUX identifiants — celui de l'équipe (`ref`) et celui
 * du worker (dans le détail de la machine). L'orchestrateur a pris le second au
 * premier essai, le 02/08, et s'est vu répondre « équipe introuvable » sur une
 * équipe qui venait de démarrer. Le harness connaît la correspondance : la
 * refuser punirait une confusion que la forme de la réponse rend inévitable.
 */
/**
 * Chantier 1 (mandat opérateur 24/08, demande directe de Chris) — le contenu
 * d'une équipe appartient à la conversation qui l'a lancée, et à elle seule.
 * Preuve dans les DEUX SENS pour chaque outil : la mission DU FIL courant est
 * rendue, la mission D'UN AUTRE FIL est refusée sans fuite de nom, de projet
 * ni de contenu.
 */
describe('cloisonnement par conversation (chantier 1)', () => {
  beforeEach(() => {
    registre.missions.creer({
      id: 'm-conv-a',
      lotId: 'lot-1',
      nom: 'secret alpha',
      projet: 'projet-secret-alpha',
      compteId: 'compte1',
      conversationId: 'conv-a',
      sessionId: 'sess-conv-a',
    });
    registre.missions.ajouterActivite('m-conv-a', 'objectif confidentiel atteint', 1_000);
    registre.etats.appliquerEtatHarness('m-conv-a', 'en_cours', { motif: 'dispatch' });
  });

  test('etat_equipe : rendu depuis SON fil', () => {
    const resultat = etatEquipe(registre, 'conv-a', 'm-conv-a');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('projet-secret-alpha');
  });

  test('☠ etat_equipe : refusé depuis un AUTRE fil, sans révéler nom ni projet', () => {
    const resultat = etatEquipe(registre, 'conv-b', 'm-conv-a');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toBe(REFUS_AUTRE_FIL);
    expect(resultat.raison).not.toContain('secret');
    expect(resultat.raison).not.toContain('projet-secret-alpha');
  });

  test('rapport_equipe : rendu depuis SON fil', () => {
    const resultat = rapportEquipe(registre, 'conv-a', 'm-conv-a');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('objectif confidentiel atteint');
  });

  test('☠ rapport_equipe : refusé depuis un AUTRE fil, jamais le texte du rapport', () => {
    const resultat = rapportEquipe(registre, 'conv-b', 'm-conv-a');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toBe(REFUS_AUTRE_FIL);
    expect(JSON.stringify(resultat)).not.toContain('objectif confidentiel');
  });

  test('historique_equipe : rendu depuis SON fil', () => {
    const resultat = historiqueEquipe(registre, 'conv-a', 'm-conv-a');
    expect(resultat.ok).toBe(true);
  });

  test('☠ historique_equipe : refusé depuis un AUTRE fil', () => {
    const resultat = historiqueEquipe(registre, 'conv-b', 'm-conv-a');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toBe(REFUS_AUTRE_FIL);
  });

  test('transcript_equipe : rendu depuis SON fil', () => {
    const resultat = transcriptEquipe(registre, 'conv-a', 'm-conv-a');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('objectif confidentiel atteint');
  });

  test('☠ transcript_equipe : refusé depuis un AUTRE fil, jamais une ligne de fil', () => {
    const resultat = transcriptEquipe(registre, 'conv-b', 'm-conv-a');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toBe(REFUS_AUTRE_FIL);
    expect(JSON.stringify(resultat)).not.toContain('objectif confidentiel');
  });

  test('suivre_equipe : rendu depuis SON fil', () => {
    const resultat = suivreEquipe(registre, 'conv-a', 'm-conv-a');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('objectif confidentiel atteint');
  });

  test('☠ suivre_equipe : refusé depuis un AUTRE fil', () => {
    const resultat = suivreEquipe(registre, 'conv-b', 'm-conv-a');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toBe(REFUS_AUTRE_FIL);
  });

  test('suivre_equipes : la mission DU fil est rendue au milieu des autres', () => {
    const resultat = suivreEquipes(registre, 'conv-a', ['m-conv-a']);
    expect(resultat.etat).toContain('objectif confidentiel atteint');
  });

  test('☠ suivre_equipes : la mission d’un AUTRE fil est signalée sans faire échouer l’appel, sans fuite', () => {
    const resultat = suivreEquipes(registre, 'conv-b', ['m-conv-a']);
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain(REFUS_AUTRE_FIL);
    expect(resultat.etat).not.toContain('objectif confidentiel');
    expect(resultat.etat).not.toContain('projet-secret-alpha');
  });

  test('☠ le sessionId d’un autre fil refuse aussi explicitement (identifiant EXACT du worker)', () => {
    const resultat = etatEquipe(registre, 'conv-b', 'sess-conv-a');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).toBe(REFUS_AUTRE_FIL);
  });

  test('☠ une recherche par NOM ne remonte jamais une mission d’un autre fil, même en ambiguïté', () => {
    // Deux missions homonymes, l'une dans conv-a (déjà créée dans le beforeEach
    // sous un autre nom), l'autre nommée pareil dans conv-b : chercher ce nom
    // depuis conv-b ne doit jamais faire remonter conv-a, y compris via une
    // liste de candidats ambigus.
    registre.missions.creer({
      id: 'm-conv-a-2',
      lotId: 'lot-1',
      nom: 'homonyme',
      projet: 'projet-secret-alpha-2',
      compteId: 'compte1',
      conversationId: 'conv-a',
    });
    registre.missions.creer({
      id: 'm-conv-b',
      lotId: 'lot-1',
      nom: 'homonyme',
      projet: 'projet-b',
      compteId: 'compte1',
      conversationId: 'conv-b',
    });
    const resultat = etatEquipe(registre, 'conv-b', 'homonyme');
    expect(resultat.ok).toBe(true);
    expect(resultat.etat).toContain('projet-b');
    expect(resultat.etat).not.toContain('projet-secret-alpha');
  });

  test('recherche par nom introuvable dans SON fil ⇒ absent, jamais confondue avec un autre fil', () => {
    // « secret alpha » n'existe que dans conv-a : cherché depuis conv-b, il
    // doit être absent — jamais un refus « autre fil », qui confirmerait son
    // existence par ce nom à qui ne le connaît pas déjà.
    const resultat = etatEquipe(registre, 'conv-b', 'secret alpha');
    expect(resultat.ok).toBe(false);
    expect(resultat.raison).not.toBe(REFUS_AUTRE_FIL);
    expect(resultat.raison).toContain('aucune équipe');
  });
});

describe('resoudreMission — l’identifiant du WORKER désigne aussi son équipe', () => {
  test('☠ un sessionId résout vers la mission qui le porte', () => {
    registre.lots.creer({ id: 'lot-w', intention: 'confusion des identifiants' });
    registre.missions.creer({
      id: 'd35acd69',
      lotId: 'lot-w',
      nom: 'refonte auth',
      projet: 'lumen',
      compteId: 'compte1',
      sessionId: 'fabdead6',
    });
    const parEquipe = resoudreMission(registre, 'd35acd69');
    const parWorker = resoudreMission(registre, 'fabdead6');
    expect('trouve' in parEquipe && parEquipe.trouve.id).toBe('d35acd69');
    expect('trouve' in parWorker && parWorker.trouve.id).toBe('d35acd69');
  });

  test('un identifiant qui n’est ni l’un ni l’autre reste absent', () => {
    expect('absent' in resoudreMission(registre, 'deadbeef-inconnu')).toBe(true);
  });
});
