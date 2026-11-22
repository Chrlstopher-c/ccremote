// Responsabilité : la charte signée du réseau — format, signature Ed25519, succession, droits, éditions.
// Fonctions pures : aucune E/S, aucun fichier, aucun réseau. Le signataire est lu dans la version courante.
import { z } from 'zod';
import { importerPubliqueSignature } from './chiffrement/cles.ts';
import { importerIdentitePublique } from './chiffrement/identite.ts';
import { depuisBase64url, enOctets, type Octets, versBase64url } from './chiffrement/octets.ts';
import { IdentitePubliqueTexte, TAILLE_MAX_CHARTE_CARACTERES } from './federation.ts';

export const DROITS = ['voir', 'piloter', 'lancer', 'remoteControl'] as const;
export type Droit = (typeof DROITS)[number];
export const Droits = z.object({
  voir: z.boolean(),
  piloter: z.boolean(),
  lancer: z.boolean(),
  remoteControl: z.boolean(),
});
export type Droits = z.infer<typeof Droits>;
export const TOUS_DROITS: Droits = { voir: true, piloter: true, lancer: true, remoteControl: true };
export const AUCUN_DROIT: Droits = { voir: false, piloter: false, lancer: false, remoteControl: false };

export const SORTES = ['serveur', 'pair', 'telephone'] as const;
export type Sorte = (typeof SORTES)[number];
const ID = z.string().regex(/^[a-f0-9]{12}$/);
const NOM = z.string().trim().min(1).max(80);
const NOMBRE_MAX_MEMBRES = 200;
const NOMBRE_MAX_CHEFS = 20;
const TAILLE_SIGNATURE = 64;

export const MembreCharte = z.object({
  id: ID,
  nom: NOM,
  sorte: z.enum(SORTES),
  identite: IdentitePubliqueTexte,
  droits: Droits,
  compte: z.string().max(200).nullable(),
});
export type MembreCharte = z.infer<typeof MembreCharte>;

export const Charte = z.object({
  format: z.literal(1),
  reseau: ID,
  nom: NOM,
  version: z.number().int().min(1),
  chefs: z.array(ID).min(1).max(NOMBRE_MAX_CHEFS),
  membres: z.array(MembreCharte).max(NOMBRE_MAX_MEMBRES),
  le: z.string().max(40),
  par: ID,
  origine: z.enum(['creation', 'reprise']),
});
export type Charte = z.infer<typeof Charte>;

export interface CharteSignee {
  readonly texte: string;
  readonly signature: string;
}

export const PREFIXE_SIGNATURE = 'lanterne-charte-v1\n';

export type MotifRefusCharte =
  | 'illisible'
  | 'signature'
  | 'autre-reseau'
  | 'ancienne'
  | 'signataire-non-chef'
  | 'sans-chef'
  | 'chef-invalide'
  | 'doublon';
export type VerdictCharte = { ok: true; charte: Charte } | { ok: false; motif: MotifRefusCharte };

type Anomalie = z.ZodError['issues'][number];

function octetsSignes(texte: string): Octets {
  return enOctets(PREFIXE_SIGNATURE + texte);
}

export async function signerCharte(charte: Charte, signaturePrivee: CryptoKey): Promise<CharteSignee> {
  const texte = JSON.stringify(charte);
  const signature = await crypto.subtle.sign('Ed25519', signaturePrivee, octetsSignes(texte));
  return { texte, signature: versBase64url(new Uint8Array(signature)) };
}

function lireJson(texte: string): unknown {
  try {
    return JSON.parse(texte);
  } catch {
    return undefined;
  }
}

function estChefsVides(anomalie: Anomalie): boolean {
  return anomalie.path[0] === 'chefs' && anomalie.code === 'too_small';
}

function coherence(c: Charte): Charte | MotifRefusCharte {
  const ids = c.membres.map((m) => m.id);
  if (new Set(ids).size !== ids.length || new Set(c.chefs).size !== c.chefs.length) return 'doublon';
  for (const chef of c.chefs) {
    const membre = c.membres.find((m) => m.id === chef);
    if (membre === undefined || membre.sorte === 'serveur') return 'chef-invalide';
  }
  if (!c.chefs.includes(c.par)) return 'signataire-non-chef';
  return c;
}

function diagnostiquer(texte: string): Charte | MotifRefusCharte {
  if (texte.length > TAILLE_MAX_CHARTE_CARACTERES) return 'illisible';
  const lu = Charte.safeParse(lireJson(texte));
  if (!lu.success) return lu.error.issues.some(estChefsVides) ? 'sans-chef' : 'illisible';
  return coherence(lu.data);
}

/** Relit une charte (fichier ou message) : null si le format ou la cohérence ne tiennent pas. Pas de signature ici. */
export function lireCharte(texte: string): Charte | null {
  const verdict = diagnostiquer(texte);
  return typeof verdict === 'string' ? null : verdict;
}

export function membreDe(charte: Charte | null, membre: string): MembreCharte | null {
  return charte?.membres.find((m) => m.id === membre) ?? null;
}

export function estChef(charte: Charte | null, membre: string): boolean {
  return charte !== null && charte.chefs.includes(membre);
}

function refus(motif: MotifRefusCharte): VerdictCharte {
  return { ok: false, motif };
}

async function signatureValide(identite: string, signature: string, texte: string): Promise<boolean> {
  try {
    const publique = await importerIdentitePublique(identite);
    const cle = await importerPubliqueSignature(publique.signature);
    const octets = depuisBase64url(signature, TAILLE_SIGNATURE);
    return await crypto.subtle.verify('Ed25519', cle, octets, octetsSignes(texte));
  } catch {
    return false;
  }
}

function motifSuccession(actuelle: Charte, proposee: Charte): MotifRefusCharte | null {
  if (proposee.reseau !== actuelle.reseau) return 'autre-reseau';
  if (proposee.version <= actuelle.version) return 'ancienne';
  if (!actuelle.chefs.includes(proposee.par)) return 'signataire-non-chef';
  return null;
}

/**
 * Accepte une charte signée si elle succède à `actuelle` (signée par un chef de `actuelle`, avec la clé lue dans
 * `actuelle`), ou si `actuelle` est null (genèse : signée par `par`, avec la clé lue dans la proposition).
 */
export async function verifierCharte(actuelle: Charte | null, proposee: CharteSignee): Promise<VerdictCharte> {
  const charte = diagnostiquer(proposee.texte);
  if (typeof charte === 'string') return refus(charte);
  if (actuelle !== null) {
    const motif = motifSuccession(actuelle, charte);
    if (motif !== null) return refus(motif);
  }
  const porteur = actuelle ?? charte;
  const signataire = membreDe(porteur, charte.par);
  if (signataire === null || !(await signatureValide(signataire.identite, proposee.signature, proposee.texte))) {
    return refus('signature');
  }
  return { ok: true, charte };
}

/** Deux reprises v1 concurrentes : la plus petite identifiant de réseau l'emporte. */
export function repriseLEmporte(actuelle: Charte, proposee: Charte): boolean {
  return (
    actuelle.origine === 'reprise' &&
    proposee.origine === 'reprise' &&
    actuelle.version === 1 &&
    proposee.version === 1 &&
    proposee.reseau < actuelle.reseau
  );
}

/** Charte absente → tout (réseau non créé) ; chef → tout ; membre absent → rien ; sinon ses droits. */
export function droitsDe(charte: Charte | null, membre: string): Droits {
  if (charte === null || estChef(charte, membre)) return { ...TOUS_DROITS };
  const trouve = membreDe(charte, membre);
  return trouve === null ? { ...AUCUN_DROIT } : { ...trouve.droits };
}

export type RequeteDroit =
  | { genre: 'api'; methode: string; chemin: string }
  | { genre: 'geste'; methode: string; suffixe: string }
  | { genre: 'fil' }
  | { genre: 'ecrire' }
  | { genre: 'interrompre' }
  | { genre: 'ouvrir' }
  | { genre: 'instantane' };

const CHEMIN_REMOTE_CONTROL = /^\/api\/sessions\/[^/]+\/remote-control$/;

/** Le contrôle à distance est testé avant la méthode : une lecture de ce chemin exige déjà `remoteControl`. */
function droitApi(methode: string, chemin: string): Droit {
  const seul = chemin.split('?')[0] ?? chemin;
  if (CHEMIN_REMOTE_CONTROL.test(seul)) return 'remoteControl';
  const verbe = methode.toUpperCase();
  if (verbe === 'GET') return 'voir';
  if (verbe === 'POST' && seul === '/api/sessions') return 'lancer';
  return 'piloter';
}

function droitGeste(methode: string, suffixe: string): Droit {
  if (suffixe === 'remote-control') return 'remoteControl';
  return methode.toUpperCase() === 'GET' ? 'voir' : 'piloter';
}

export function droitRequis(requete: RequeteDroit): Droit {
  switch (requete.genre) {
    case 'api':
      return droitApi(requete.methode, requete.chemin);
    case 'geste':
      return droitGeste(requete.methode, requete.suffixe);
    case 'fil':
    case 'instantane':
      return 'voir';
    case 'ecrire':
    case 'interrompre':
      return 'piloter';
    case 'ouvrir':
      return 'lancer';
  }
}

export function autorise(charte: Charte | null, membre: string, requete: RequeteDroit): boolean {
  return droitsDe(charte, membre)[droitRequis(requete)];
}

// ÉDITION : fonctions pures, elles rendent une charte NON signée (version + 1, auteur = `par`).

export type Edition = { ok: true; charte: Charte } | { ok: false; raison: string };

export interface MembreSansDroits {
  readonly id: string;
  readonly nom: string;
  readonly identite: string;
}

function refuse(raison: string): Edition {
  return { ok: false, raison };
}

function suivante(c: Charte, auteur: string, le: string, membres: MembreCharte[], chefs: string[]): Edition {
  return { ok: true, charte: { ...c, version: c.version + 1, membres, chefs, le, par: auteur } };
}

function nomValide(nom: string, repli: string): string {
  const net = nom.trim().slice(0, 80);
  return net === '' ? repli : net;
}

function membreAvec(m: MembreSansDroits, sorte: Sorte): MembreCharte {
  return {
    id: m.id,
    nom: nomValide(m.nom, m.id),
    sorte,
    identite: m.identite,
    droits: { ...TOUS_DROITS },
    compte: null,
  };
}

export function creerCharte(p: {
  reseau: string;
  nom: string;
  moi: MembreSansDroits;
  le: string;
  origine?: 'creation' | 'reprise';
}): Charte {
  return {
    format: 1,
    reseau: p.reseau,
    nom: nomValide(p.nom, p.reseau),
    version: 1,
    chefs: [p.moi.id],
    membres: [membreAvec(p.moi, 'pair')],
    le: p.le,
    par: p.moi.id,
    origine: p.origine ?? 'creation',
  };
}

function ajouterSans(
  membres: MembreCharte[],
  vus: Set<string>,
  liste: readonly MembreSansDroits[],
  sorte: Sorte,
): void {
  for (const m of liste) {
    if (vus.has(m.id)) continue;
    vus.add(m.id);
    membres.push(membreAvec(m, sorte));
  }
}

/** Reprise du parc : moi chef (pair), nœuds serveur, appareils téléphone ; doublons d'id ignorés. */
export function repriseDuParc(p: {
  reseau: string;
  nom: string;
  moi: MembreSansDroits;
  noeuds: readonly MembreSansDroits[];
  appareils: readonly MembreSansDroits[];
  le: string;
}): Charte {
  const membres: MembreCharte[] = [membreAvec(p.moi, 'pair')];
  const vus = new Set<string>([p.moi.id]);
  ajouterSans(membres, vus, p.noeuds, 'serveur');
  ajouterSans(membres, vus, p.appareils, 'telephone');
  return {
    format: 1,
    reseau: p.reseau,
    nom: nomValide(p.nom, p.reseau),
    version: 1,
    chefs: [p.moi.id],
    membres: membres.slice(0, NOMBRE_MAX_MEMBRES),
    le: p.le,
    par: p.moi.id,
    origine: 'reprise',
  };
}

export function nommerChef(c: Charte, auteur: string, membre: string, chef: boolean, le: string): Edition {
  if (!estChef(c, auteur)) return refuse('auteur non chef');
  const cible = membreDe(c, membre);
  if (cible === null) return refuse('membre absent');
  if (chef && cible.sorte === 'serveur') return refuse('un serveur ne peut pas être chef');
  if (!chef && membre === auteur) return refuse('un chef ne retire pas son propre rôle');
  const chefs = chef ? [...new Set([...c.chefs, membre])] : c.chefs.filter((x) => x !== membre);
  return suivante(c, auteur, le, c.membres, chefs);
}

export function ajouterMembre(c: Charte, auteur: string, m: MembreCharte, le: string): Edition {
  if (!estChef(c, auteur)) return refuse('auteur non chef');
  if (membreDe(c, m.id) !== null) return refuse('déjà membre');
  return suivante(c, auteur, le, [...c.membres, m], c.chefs);
}

export function retirerMembre(c: Charte, auteur: string, membre: string, le: string): Edition {
  if (!estChef(c, auteur)) return refuse('auteur non chef');
  if (membreDe(c, membre) === null) return refuse('membre absent');
  const chefs = c.chefs.filter((x) => x !== membre);
  if (chefs.length === 0) return refuse('dernier chef');
  if (membre === auteur) return refuse('un chef ne se retire pas lui-même');
  return suivante(c, auteur, le, c.membres.filter((m) => m.id !== membre), chefs);
}

export function changerMembre(
  c: Charte,
  auteur: string,
  membre: string,
  champs: { droits?: Droits; compte?: string | null; nom?: string },
  le: string,
): Edition {
  if (!estChef(c, auteur)) return refuse('auteur non chef');
  const cible = membreDe(c, membre);
  if (cible === null) return refuse('membre absent');
  const modifie: MembreCharte = {
    ...cible,
    droits: champs.droits ? { ...champs.droits } : cible.droits,
    compte: champs.compte === undefined ? cible.compte : champs.compte,
    nom: champs.nom === undefined ? cible.nom : nomValide(champs.nom, cible.id),
  };
  return suivante(c, auteur, le, c.membres.map((m) => (m.id === membre ? modifie : m)), c.chefs);
}
