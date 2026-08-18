/**
 * Le dimensionnement des modèles — ce qui décide du coût réel d'une équipe.
 *
 * `☠` Défaut mesuré en production le 01/08 : le site lumen a coûté **52,93 $ en
 * six vagues**, aucune sous 3,85 $. Deux causes, et aucune n'était un bug de
 * code — les deux étaient écrites noir sur blanc dans des prompts :
 *
 *   1. l'orchestrateur lisait « laisse `modele` et `effort` vides » et
 *      « ne choisis JAMAIS un modèle inférieur de ta propre initiative ». Il a
 *      obéi. Interrogé le 01/08 par le banc de pilotage, il l'a confirmé mot pour
 *      mot : « Je ne le choisis pas. » ;
 *   2. rien ne disait au lead que `AgentInput.model` est optionnel et que, omis,
 *      un sous-agent HÉRITE du modèle du parent. Un lead Opus lançant trois
 *      sous-agents en lançait donc trois en Opus, sans l'avoir décidé.
 *
 * Ces tests gardent les deux moitiés. La plus importante est la dernière : les
 * alias écrits dans le prompt doivent être ceux que le SDK accepte réellement —
 * c'est la forme exacte du défaut « sonnet 5 » du 31/07, une chaîne plausible
 * que rien ne validait, et du défaut `WebSearch` du 01/08, une capacité promise
 * au modèle et absente de sa liste d'outils.
 */

import { describe, expect, test } from 'bun:test';
import { composerMandatSysteme } from './dispatch-mandat.ts';
import { MANDAT_ORCHESTRATEUR } from './processus/mandat.ts';
import { normaliserModele } from '../../shared/modeles-claude.ts';
import { MCP_EQUIPE } from '../../workers/mcp-du-poste.ts';
import { NOM_SERVEUR_MCP_DEPENSE } from '../../workers/mcp-depense/serveur.ts';
import type { Proposition } from '../registre/index.ts';

const MANDAT: Proposition = {
  id: 'p1',
  conversationId: 'conv-a',
  projet: 'lumen',
  objectif: 'construire la landing page',
  critereArret: 'le site build et les 10 sections sont en place',
  perimetre: 'src/ uniquement',
  acces: 'ecriture',
  budgetMaxUsd: 0,
  modele: null,
  effort: null,
  statut: 'en_attente',
  missionId: null,
  detail: null,
  creeA: 0,
  majA: 0,
};

/**
 * `☠` Les valeurs acceptées par l'outil Task du SDK, LUES dans
 * `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` :
 *
 *   model?: "sonnet" | "opus" | "haiku" | "fable"
 *
 * Ce sont des ALIAS. Un identifiant complet (`claude-sonnet-5`) y est refusé.
 * Si une mise à jour du SDK change cette liste, ce test doit être repassé sur le
 * fichier réel — pas ajusté pour redevenir vert.
 */
const ALIAS_SDK = ['sonnet', 'opus', 'haiku', 'fable'] as const;

const mandatSysteme = composerMandatSysteme(MANDAT, 'ecriture');

describe('ce que le lead doit savoir pour ne pas payer le prix fort', () => {
  test('☠ on lui DIT que l’omission fait hériter du modèle parent', () => {
    // C'est le fait qui explique les 52,93 $ : sans lui, la consigne « choisis »
    // reste théorique, parce que ne pas choisir semble neutre.
    expect(mandatSysteme).toContain('HÉRITE');
    expect(mandatSysteme.toLowerCase()).toContain('sous-agents lancés sans rien préciser');
  });

  test('☠ les alias cités sont ceux que le SDK accepte, pas des identifiants complets', () => {
    // Le défaut « sonnet 5 » du 31/07 : une chaîne plausible, refusée à l'usage.
    for (const alias of ['sonnet', 'opus', 'haiku']) {
      expect(mandatSysteme).toContain(`\`${alias}\``);
      expect(ALIAS_SDK).toContain(alias as (typeof ALIAS_SDK)[number]);
    }
    // Aucun identifiant complet ne doit apparaître dans la consigne Task.
    expect(mandatSysteme).not.toContain('`claude-sonnet-5`');
    expect(mandatSysteme).not.toContain('`claude-opus-5`');
  });

  test('le critère donné est actionnable — pas « facile / difficile »', () => {
    // Un modèle ne sait pas juger la difficulté d'une tâche qu'il n'a pas faite.
    // Il sait dire si la décision est déjà prise. C'est ce qu'on lui demande.
    expect(mandatSysteme).toContain('ai-je déjà tranché comment');
  });

  test('☠ la contrepartie de Sonnet est nommée, et la parade ne coûte rien', () => {
    // Sans ça, la consigne se retourne : des sous-agents moins chers qui rendent
    // du travail non vérifié coûtent plus qu'ils n'économisent.
    expect(mandatSysteme).toContain('PREUVE MÉCANIQUE');
    expect(mandatSysteme).toContain('aucun token');
    // Et la relecture Opus reste le SECOND filet — sinon on réintroduit le coût
    // qu'on vient de retirer.
    expect(mandatSysteme).toContain('second filet');
  });

  test('le dimensionnement survit à la compaction — il est dans le systemPrompt', () => {
    // `☠` Même raison que le rapport et le budget : le premier message NE survit
    // PAS à une compaction, et un lead compacté relance des sous-agents.
    expect(mandatSysteme).toContain('DIMENSIONNE TES SOUS-AGENTS');
  });
});

/**
 * `☠` LE test d'assemblage, celui qui manquait deux fois. Le 01/08 au matin, le
 * mandat de l'orchestrateur annonçait `WebSearch` absent de son allowlist. Le
 * même jour, on découvrait que le mandat du lead lui ordonnait d'utiliser
 * Playwright alors qu'aucune équipe n'a jamais eu un seul serveur MCP.
 *
 * Deux surfaces différentes, un seul défaut : un prompt qui promet une capacité
 * que rien ne fournit. Un modèle ne peut pas s'en apercevoir — il essaie, échoue,
 * contourne, et brûle des tours à le faire.
 */
describe('☠ tout outil NOMMÉ au lead doit exister réellement', () => {
  // `☠` La liste des serveurs RÉELLEMENT transmis à une équipe n'est plus
  // `MCP_EQUIPE` seule depuis le 18/08 : `ccremote-depense` est un serveur
  // en-process maison (`workers/mcp-depense/serveur.ts`), assemblé directement
  // par `construireWorkerSpec` — jamais lu depuis `~/.claude.json` du poste,
  // donc structurellement absent de `MCP_EQUIPE`. La liste blanche reste
  // FERMÉE : on l'étend nommément, on ne l'ouvre pas.
  const SERVEURS_REELLEMENT_TRANSMIS = [...MCP_EQUIPE, NOM_SERVEUR_MCP_DEPENSE];

  test('chaque serveur MCP cité dans le mandat est bien transmis aux équipes', () => {
    // On lit les serveurs cités sous la forme `mcp__<serveur>__*` dans le prompt,
    // et on exige que chacun figure dans la liste réellement transmise.
    const cites = [...mandatSysteme.matchAll(/mcp__([a-z-]+)__/g)].map((m) => m[1]);
    expect(cites.length).toBeGreaterThan(0);
    for (const serveur of cites) {
      expect(SERVEURS_REELLEMENT_TRANSMIS).toContain(serveur as string);
    }
  });

  test('les serveurs transmis qui servent la validation E2E sont bien annoncés', () => {
    // L'inverse du test précédent : un outil fourni mais jamais nommé est un
    // outil que le lead n'utilisera pas — payé, et inutile.
    for (const serveur of ['codeindex', 'playwright', 'log-watcher']) {
      expect(mandatSysteme).toContain(`mcp__${serveur}__`);
    }
  });

  test('☠ l’outil de consultation de sa propre dépense est bien annoncé (mandat 18/08)', () => {
    // Le second livrable du mandat : un outil que le modèle ignore n'existe pas
    // pour lui. Sans cette ligne, `ccremote-depense` serait transmis mais jamais
    // cité — exactement le motif « écrit, testé, branché sur rien ».
    expect(mandatSysteme).toContain(`mcp__${NOM_SERVEUR_MCP_DEPENSE}__ma_depense`);
  });

  test('☠ l’écriture en mémoire sémantique est cadrée par H-66', () => {
    // Elle est PARTAGÉE avec l'humain et les autres équipes. Une équipe qui y
    // attribue à Chris une décision de l'orchestrateur pose un faux qui lui
    // survit — H-66 appliqué à un support persistant.
    expect(mandatSysteme).toContain('PARTAGÉE');
    expect(mandatSysteme).toContain('n’attribue JAMAIS');
  });
});

describe('ce que l’orchestrateur doit savoir pour arbitrer', () => {
  test('☠ l’interdiction d’arbitrer a bien DISPARU', () => {
    // Le texte exact qu'il citait le 01/08 en refusant de choisir.
    expect(MANDAT_ORCHESTRATEUR).not.toContain('laisse \\`modele\\` et \\`effort\\` vides');
    expect(MANDAT_ORCHESTRATEUR).not.toContain('ne choisis JAMAIS un modèle inférieur');
  });

  test('il lui est demandé d’arbitrer, pas de renvoyer la question', () => {
    // `☠` Insensible à la casse depuis le dégraissage du 07/08 : le mandat a
    // perdu ses majuscules d'emphase, que le modèle recopiait dans ses réponses
    // à Chris. Ce qui doit être protégé ici est la CONSIGNE — il choisit, il ne
    // renvoie pas la question — jamais la typographie qui la portait.
    expect(MANDAT_ORCHESTRATEUR).toMatch(/sans consigne, tu choisis/i);
    expect(MANDAT_ORCHESTRATEUR).toMatch(/ne lui renvoie pas la question/i);
  });

  test('☠ les identifiants qu’il doit écrire passent le validateur du harness', () => {
    // Côté `creer_equipe`, ce sont des identifiants COMPLETS qui sont attendus —
    // l'inverse exact de l'outil Task. Deux surfaces, deux formes : c'est
    // précisément le genre d'écart qui produit une équipe morte en deux secondes.
    for (const id of ['claude-sonnet-5', 'claude-opus-5']) {
      expect(MANDAT_ORCHESTRATEUR).toContain(id);
      expect(normaliserModele(id)).not.toBeNull();
    }
  });

  test('une consigne humaine garde la priorité sur son arbitrage', () => {
    expect(MANDAT_ORCHESTRATEUR).toContain('passe avant tout');
  });

  test('il doit annoncer son choix — sinon l’arbitrage devient invisible', () => {
    // La carte d'autorisation est le seul endroit où Chris peut le corriger
    // avant la dépense. `☠` Insensible à la casse, même raison que ci-dessus.
    expect(MANDAT_ORCHESTRATEUR).toMatch(/annonce ton choix en une ligne/i);
  });
});
