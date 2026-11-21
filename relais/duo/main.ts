// Responsabilité : passer la main à un pair. Le donneur construit un paquet (titre, dossier, derniers messages, dernier
// bilan de Claude, fichiers modifiés) sans appel à un modèle et l'envoie ; le receveur tranche, choisit le dossier, et
// la session neuve s'ouvre par la route de création habituelle, paquet en premier message. La session d'origine garde
// une ligne « passée à <nom> ».
import {
  DELAI_MARGE_REPONSE_MS,
  NOMBRE_MAX_MESSAGES_PAQUET,
  PaquetMain,
  TAILLE_MAX_BILAN_PAQUET,
  type MessageLien,
} from '../../commun/duo.ts';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { Registre } from '../registre/registre.ts';
import { conclure, type Contexte, type Requete, requeteAuPair, verdictDuPair } from './contexte.ts';
import { bilan, identifiantSession } from './pont-sessions.ts';
import { echec, ok, type Resultat, STATUT_REFUS_DUO } from './resultat.ts';

type LigneMain = Extract<MessageLien, { type: 'passer_main' }>;

const EVENEMENTS_RELUS = 400; // derniers événements du fil relus pour composer le paquet
const FICHIERS_MAX_PAQUET = 200;

/** Le paquet d'une session, tiré de son fil : aucun appel à un modèle. */
export function construirePaquet(registre: Registre, fiche: ResumeSession, note?: string): PaquetMain {
  const evts = registre.derniersEvenements(fiche.id, EVENEMENTS_RELUS).map((e) => e.evt);
  return {
    titre: fiche.titre,
    dossier: fiche.cwd,
    messages: messagesDe(evts),
    bilan: dernierBilan(evts),
    fichiers: fichiersDe(evts),
    ...(note ? { note } : {}),
  };
}

function messagesDe(evts: readonly Evenement[]): string[] {
  const textes = evts.flatMap((e) => (e.type === 'message' ? [e.texte] : []));
  return textes.slice(-NOMBRE_MAX_MESSAGES_PAQUET);
}

function dernierBilan(evts: readonly Evenement[]): string {
  for (let i = evts.length - 1; i >= 0; i--) {
    const e = evts[i];
    if (e?.type === 'texte') return e.texte.slice(0, TAILLE_MAX_BILAN_PAQUET);
  }
  return '';
}

function fichiersDe(evts: readonly Evenement[]): string[] {
  const chemins = new Set<string>();
  for (const e of evts) {
    if (e.type === 'fichiers_tour') for (const f of e.fichiers) chemins.add(f.chemin);
  }
  return [...chemins].slice(-FICHIERS_MAX_PAQUET);
}

/** Le texte du premier message de la session neuve : ce que le paquet dit, en rubriques séparées (Markdown), lisible
 * par Claude comme par celui qui reprend. */
export function textePaquet(p: PaquetMain, de: string): string {
  const blocs = [`**Session passée par ${de} : ${p.titre}**`, `Dossier d'origine : \`${p.dossier}\``];
  if (p.note) blocs.push(`**Note de ${de}**\n\n${p.note}`);
  if (p.messages.length > 0) blocs.push(`**Derniers messages**\n\n${p.messages.map((m) => `- ${uneLigne(m)}`).join('\n')}`);
  if (p.bilan !== '') blocs.push(`**Dernier bilan de Claude**\n\n${p.bilan}`);
  if (p.fichiers.length > 0) blocs.push(`**Fichiers modifiés**\n\n${p.fichiers.map((f) => `- \`${f}\``).join('\n')}`);
  blocs.push('Reprends ce travail là où il en est.');
  return blocs.join('\n\n');
}

// Un message tient sur une ligne de liste : ses retours à la ligne deviennent des espaces.
function uneLigne(texte: string): string {
  return texte.replace(/\s*\n\s*/g, ' ').trim();
}

/** Donneur : envoie la session au pair. Rend l'identifiant de la session neuve chez lui. */
export async function passerLaMain(
  c: Contexte,
  session: string,
  note: string | undefined,
): Promise<Resultat<string | null>> {
  const fiche = c.registre.session(session);
  if (!fiche) return echec(404, 'session introuvable');
  if (fiche.duo) return echec(STATUT_REFUS_DUO, 'session du pair : elle tourne chez lui');
  const paquet = construirePaquet(c.registre, fiche, note);
  const delai = c.delaiDemandeMs + DELAI_MARGE_REPONSE_MS;
  const r = await requeteAuPair(c, (ref) => ({ type: 'passer_main', ref, paquet }), delai);
  const verdict = verdictDuPair(r);
  if (!verdict.ok) return verdict;
  c.fil(session, { type: 'duo_main', vers: c.nomPair() });
  return ok(verdict.valeur);
}

/** Receveur : demande l'accord de Chris, puis ouvre la session neuve dans le dossier qu'il a choisi. */
export async function recevoirMain(c: Contexte, nom: string, m: LigneMain): Promise<void> {
  const requete: Requete = { nom, ref: m.ref, action: 'passer_la_main', cible: m.paquet.titre };
  const resume = textePaquet(m.paquet, nom).slice(0, 8000);
  const reponse = await c.demandes.demander('passer_la_main', nom, m.paquet.titre, undefined, resume);
  if (!reponse.accord) {
    return conclure(c, requete, {
      ok: false,
      raison: `refusé par ${c.nomLocal()}`,
      detail: 'refusé : pas d’accord de Chris (refus ou délai)',
    });
  }
  if (!reponse.choix) return conclure(c, requete, { ok: false, raison: 'aucun dossier choisi' });
  const { machine, chemin } = reponse.choix;
  const r = await bilan(
    await c.sessions.ouvrir({
      machine,
      projet: { machine, chemin, nom: nomDossier(chemin) },
      message: textePaquet(m.paquet, nom),
      autonomie: false,
      mode: 'default',
    }),
  );
  if (!r.ok) return conclure(c, requete, { ok: false, raison: r.raison });
  const id = identifiantSession(r.valeur);
  if (!id) return conclure(c, requete, { ok: false, raison: 'session ouverte sans identifiant' });
  conclure(c, requete, { ok: true, detail: `session neuve : ${id}`, session: id });
}

function nomDossier(chemin: string): string {
  return chemin.split('/').filter(Boolean).pop() ?? chemin;
}
