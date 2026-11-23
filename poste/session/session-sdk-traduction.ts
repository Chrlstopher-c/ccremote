// Responsabilité : la traduction des messages du SDK vers les événements du fil, message par message — tâches de fond,
// modèle réel, identifiant SDK, mode, limites de quota, fin de tour ; et le titre généré relu dans le transcript.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { nomLisibleModele } from './modele-affiche.ts';
import { etatRapideLu, modeDeInit, rapideLu } from './modes-sdk.ts';
import { cheminTranscript } from './transcript.ts';
import { titreGenereDuTranscript } from './titre-transcript.ts';
import type { EtatTraduction } from './traduction-sdk.ts';
import { clorTour, emettre, maj, memoriser, type NoyauSdk } from './session-sdk-noyau.ts';
import { constater, finDeTour } from './session-sdk-bilan.ts';

export function traiter(n: NoyauSdk, msg: SDKMessage, etatTraduction: EtatTraduction): void {
  n.registreTaches.observer(msg);
  const sortie = n.traduction.traduire(msg, etatTraduction);
  // Après une interruption de Chris, le SDK rend son résultat en erreur : ce n'est pas une panne du tour.
  const evenements = sortie.evenements.filter((evt) => evt.type !== 'erreur' || !n.interrompuParChris);
  for (const evt of evenements) {
    if (evt.type === 'tour_fini') clorTour(n);
    constater(n, evt);
    emettre(n, evt);
  }
  n.bilan.observer(evenements, sortie.compaction === true);
  n.presentation?.depuisMessage(msg);
  const modeRapide = etatRapideLu(msg);
  if (modeRapide) maj(n, { rapide: rapideLu(n.etat.rapide, modeRapide) });
  if (sortie.claudeSessionId && sortie.claudeSessionId !== n.etat.claudeSessionId) {
    memoriser(n, n.etat.claudeSessionId);
    memoriser(n, sortie.claudeSessionId);
    maj(n, { claudeSessionId: sortie.claudeSessionId });
  }
  const mode = modeDeInit(msg);
  if (mode && mode !== n.etat.mode) maj(n, { mode }); // la fiche dit le mode réel, pas « inconnu »
  if (sortie.compaction) maj(n, { statut: 'compaction' });
  // Compaction automatique en plein tour : le CLI reprend seul ; à la réponse du modèle, la session repasse à travail.
  else if (msg.type === 'assistant' && msg.parent_tool_use_id === null && n.etat.statut === 'compaction')
    maj(n, { statut: 'travail' });
  if (sortie.limite) n.env.limite?.(sortie.limite);
  if (sortie.suggestion !== undefined && sortie.suggestion.trim() !== '') maj(n, { suggestion: sortie.suggestion.trim() });
  if (sortie.finDeTour) finDeTour(n, sortie.finDeTour);
}

// Titre généré par Claude (ai-title) ou renommage, relu dans le transcript à la fin de chaque tour.
export function titreRelu(n: NoyauSdk): void {
  const conversation = n.etat.claudeSessionId;
  if (!conversation) return;
  const chemin = cheminTranscript(n.etat.cwd, conversation, n.p.configDir);
  const titre = titreGenereDuTranscript(chemin, n.etat.cwd, n.env.journal);
  if (titre && titre !== n.etat.titre) maj(n, { titre });
}

// Session sur le modèle par défaut du compte : le nom réel est celui du dernier message assistant.
export function nommerModeleVu(n: NoyauSdk, msg: SDKMessage): void {
  if (msg.type !== 'assistant' || n.etat.modele !== 'défaut') return;
  const modele: unknown = msg.message.model;
  if (typeof modele !== 'string' || modele === '' || modele.startsWith('<')) return;
  const nom = nomLisibleModele(modele);
  if (nom !== (n.etat.modeleNom ?? null)) maj(n, { modeleNom: nom });
}
