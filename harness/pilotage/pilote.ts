#!/usr/bin/env bun
/**
 * Responsabilité : piloter le harness de PRODUCTION depuis une session de code —
 * ouvrir un fil d'orchestrateur, lui parler, autoriser un mandat, lire une équipe,
 * relever ce que tout ça a coûté.
 *
 * Pourquoi ce banc existe (demande de Chris, 01/08) : le dimensionnement des
 * équipes se décidait sur des impressions. Une doctrine « Sonnet pour le code
 * cadré, Opus pour la profondeur » ne vaut que si on peut la CHIFFRER, et la
 * chiffrer supposait jusqu'ici que Chris joue chaque scénario à la main dans
 * l'interface. Un scénario coûte 20 minutes d'attention humaine et ~5 $ ; il en
 * faut plusieurs pour comparer quoi que ce soit.
 *
 * `☠` Ce banc parle à la PROD. Il n'existe pas d'instance de recette, et il ne
 * faut pas en inventer une : ce qu'on veut mesurer (coût réel, quotas réels,
 * modèles réellement résolus) n'existe qu'ici. En conséquence, tout ce qui
 * dépense — envoyer un message, autoriser un mandat — passe par une commande
 * explicite. Aucune commande n'enchaîne un dispatch de sa propre initiative.
 *
 * Usage :
 *   bun pilotage/pilote.ts sante
 *   bun pilotage/pilote.ts conversations
 *   bun pilotage/pilote.ts ouvrir "titre du fil"
 *   bun pilotage/pilote.ts dire <convId> "message"      # attend la fin du tour
 *   bun pilotage/pilote.ts lire <convId> [n]
 *   bun pilotage/pilote.ts parc
 *   bun pilotage/pilote.ts equipe <missionId> [n]
 *   bun pilotage/pilote.ts mandats
 *   bun pilotage/pilote.ts autoriser <propositionId>
 *   bun pilotage/pilote.ts refuser <propositionId>
 *
 * Le mot de passe vient de `CCREMOTE_UI_PASSWORD` — jamais d'un défaut en dur.
 */

import { attendreFinDeTour, ClientPilote, ErreurPilote, type EvenementFil } from './client-pilote.ts';
import { ligneEvenement, profilTour, tableauMissions, texteEntier } from './rendu-terminal.ts';

function client(): ClientPilote {
  const motDePasse = process.env['CCREMOTE_UI_PASSWORD'];
  if (motDePasse === undefined || motDePasse.length === 0) {
    throw new ErreurPilote('CCREMOTE_UI_PASSWORD absent — export requis, jamais de valeur par défaut en dur');
  }
  return new ClientPilote(motDePasse, process.env['CCREMOTE_BASE'] ?? undefined);
}

/** `☠` Le PC absent est un état nominal (H-75), pas une panne — on le DIT. */
function avertirSiPcAbsent(pcOnline: boolean, stale: boolean): void {
  if (!pcOnline) console.error('⚠ PC absent — données du Pi seulement' + (stale ? ' (périmées)' : ''));
}

async function cmdSante(): Promise<void> {
  const s = await client().sante();
  console.log(`harness ${s.ok ? 'joignable' : 'en panne'} · PC ${s.pcOnline ? 'en ligne' : 'absent'}`);
}

async function cmdConversations(): Promise<void> {
  const { data, pcOnline, stale } = await client().conversations();
  avertirSiPcAbsent(pcOnline, stale);
  for (const c of data) {
    const quand = new Date(c.majA).toLocaleString('fr-FR');
    console.log(`${c.id}  ${c.active ? '●' : '○'} ${quand}  ${c.titre}`);
  }
  console.log(`— ${data.length} fils`);
}

async function cmdOuvrir(titre: string | undefined): Promise<void> {
  const r = await client().creerConversation(titre);
  console.log(r.conversation.id);
}

/**
 * Envoie et ATTEND. `☠` Sans l'attente, la commande rendrait la main avant que
 * le modèle ait parlé et le fil relu serait celui d'avant — un banc qui mesure
 * l'état précédent est pire qu'un banc absent, parce qu'il rend un chiffre.
 */
async function cmdDire(convId: string, message: string): Promise<void> {
  const c = client();
  const avant = (await c.fil(convId)).data.events.length;
  const debut = Date.now();
  await c.envoyer(convId, message);
  const { fini, fil } = await attendreFinDeTour(c, convId);
  const nouveaux = fil.events.slice(avant);
  console.log(`— tour ${fini ? 'terminé' : 'TOUJOURS EN COURS (délai dépassé)'} en ${Math.round((Date.now() - debut) / 1000)} s`);
  console.log(profilTour(nouveaux));
  console.log(`— contexte : ${fil.contextPct === null ? 'non relevé' : `${fil.contextPct} %`}`);
  console.log('\n' + texteEntier(nouveaux));
}

async function cmdLire(convId: string, n: number): Promise<void> {
  const { data, pcOnline, stale } = await client().fil(convId);
  avertirSiPcAbsent(pcOnline, stale);
  const evts: readonly EvenementFil[] = data.events.slice(-n);
  console.log(`${data.titre}  ·  ${data.events.length} évènements  ·  ${data.generating ? 'TOUR EN COURS' : 'au repos'}`);
  for (const e of evts) console.log(ligneEvenement(e));
}

async function cmdParc(): Promise<void> {
  const { data, pcOnline, stale } = await client().missions();
  avertirSiPcAbsent(pcOnline, stale);
  console.log(tableauMissions(data));
}

async function cmdEquipe(missionId: string, n: number): Promise<void> {
  const { data } = await client().mission(missionId);
  const feed = Array.isArray(data['feed']) ? (data['feed'] as Record<string, unknown>[]) : [];
  const sousAgents = Array.isArray(data['subagents']) ? (data['subagents'] as Record<string, unknown>[]) : [];
  console.log(`${String(data['title'])}  ·  ${String(data['state'])}  ·  ${String(data['cost'])} $  ·  modèle ${String(data['model'])}`);
  console.log(`sous-agents : ${sousAgents.length === 0 ? 'aucun' : sousAgents.map((s) => `${String(s['type'])} (${String(s['status'] ?? s['statut'])})`).join(', ')}`);
  for (const e of feed.slice(-n)) console.log(`· ${String(e['kind'] ?? e['type'])}  ${String(e['text'] ?? e['tool'] ?? '').replace(/\s+/g, ' ').slice(0, 150)}`);
}

async function cmdMandats(): Promise<void> {
  const { data } = await client().propositions();
  if (data.length === 0) { console.log('aucun mandat en attente'); return; }
  for (const p of data) console.log(JSON.stringify(p, null, 2));
}

async function cmdTrancher(id: string, decision: 'approve' | 'reject'): Promise<void> {
  console.log(JSON.stringify(await client().trancherMandat(id, decision)));
}

const AIDE = `pilote — banc de contrôle du harness (prod)

  sante                        état du harness et du lien PC
  conversations                fils de l'orchestrateur
  ouvrir [titre]               nouveau fil, rend son id
  dire <convId> <message>      envoie et ATTEND la fin du tour
  lire <convId> [n=30]         n derniers évènements d'un fil
  parc                         équipes, états, coûts, modèles
  equipe <missionId> [n=30]    fil et sous-agents d'une équipe
  mandats                      propositions en attente d'autorisation
  autoriser <propositionId>    lance l'équipe (DÉPENSE)
  refuser <propositionId>

CCREMOTE_UI_PASSWORD requis. CCREMOTE_BASE pour viser un autre hôte.`;

async function principal(): Promise<void> {
  const [commande, ...args] = process.argv.slice(2);
  switch (commande) {
    case 'sante': return cmdSante();
    case 'conversations': return cmdConversations();
    case 'ouvrir': return cmdOuvrir(args[0]);
    case 'dire': {
      if (args[0] === undefined || args[1] === undefined) throw new ErreurPilote('usage : dire <convId> <message>');
      return cmdDire(args[0], args.slice(1).join(' '));
    }
    case 'lire': {
      if (args[0] === undefined) throw new ErreurPilote('usage : lire <convId> [n]');
      return cmdLire(args[0], Number(args[1] ?? 30));
    }
    case 'parc': return cmdParc();
    case 'equipe': {
      if (args[0] === undefined) throw new ErreurPilote('usage : equipe <missionId> [n]');
      return cmdEquipe(args[0], Number(args[1] ?? 30));
    }
    case 'mandats': return cmdMandats();
    case 'autoriser': {
      if (args[0] === undefined) throw new ErreurPilote('usage : autoriser <propositionId>');
      return cmdTrancher(args[0], 'approve');
    }
    case 'refuser': {
      if (args[0] === undefined) throw new ErreurPilote('usage : refuser <propositionId>');
      return cmdTrancher(args[0], 'reject');
    }
    default:
      console.log(AIDE);
      return;
  }
}

principal().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : String(erreur));
  process.exit(1);
});
