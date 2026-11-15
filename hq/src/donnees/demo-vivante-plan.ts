// Responsabilité : le plan de la réponse simulée de la démo vivante — suite d'étapes temporisées (outils, flux, texte,
// fin de tour) jouées après une action de Chris. Pur : rien n'est planifié ni émis ici.
import type { Dialogue, Evenement, ReponseDialogue, ResumeSession } from './contrat';

export interface Etape {
  readonly delaiMs: number;
  readonly evenements: readonly Evenement[];
  readonly patch?: Partial<ResumeSession>;
}

const TEXTE_REPONSE =
  'Bien reçu. Je reprends ce point, je relis les fichiers concernés et je reviens vers toi avec un point d étape.';
const PAS_MS = 150;
const MORCEAUX_FLUX = 6;
const FLUX_DEPART_MS = 4 * PAS_MS;
const FIN_TOUR_MS = FLUX_DEPART_MS + MORCEAUX_FLUX * PAS_MS;
const DUREE_TOUR_MS = 1_500;
const CONTEXTE_TOUR = 84_000;

function etape(delaiMs: number, evenements: readonly Evenement[], patch?: Partial<ResumeSession>): Etape {
  return { delaiMs, evenements, patch };
}

function decouper(texte: string, morceaux: number): string[] {
  const taille = Math.ceil(texte.length / morceaux);
  return Array.from({ length: morceaux }, (_, i) => texte.slice(i * taille, (i + 1) * taille));
}

// `suffixe` rend les identifiants d'outils et de bloc uniques (le numéro d'événement convient).
export function planTour(suffixe: number): Etape[] {
  const lecture = `o-${suffixe}-lecture`;
  const recherche = `o-${suffixe}-grep`;
  const bloc = `b-${suffixe}`;
  const flux = decouper(TEXTE_REPONSE, MORCEAUX_FLUX).map((delta, i) =>
    etape(FLUX_DEPART_MS + i * PAS_MS, [{ type: 'flux', bloc, delta }]),
  );
  return [
    etape(0, [
      {
        type: 'outil',
        id: lecture,
        nom: 'Read',
        resume: 'src/donnees/demo.ts',
        detail: '{"file_path": "src/donnees/demo.ts"}',
      },
    ]),
    etape(PAS_MS, [{ type: 'resultat_outil', outilId: lecture, extrait: '63 lignes lues', erreur: false }]),
    etape(2 * PAS_MS, [
      { type: 'outil', id: recherche, nom: 'Grep', resume: 'envoyerMessage', detail: '{"pattern": "envoyerMessage"}' },
    ]),
    etape(3 * PAS_MS, [
      { type: 'resultat_outil', outilId: recherche, extrait: 'demo.ts : 1 occurrence', erreur: false },
    ]),
    ...flux,
    etape(
      FIN_TOUR_MS,
      [
        { type: 'texte', texte: TEXTE_REPONSE },
        { type: 'tour_fini', dureeMs: DUREE_TOUR_MS, contexte: CONTEXTE_TOUR },
      ],
      { statut: 'attente' },
    ),
  ];
}

// Résumé de la réponse de Chris, lisible dans le fil : libellés des options cochées, ou texte libre.
export function resumeReponse(dialogue: Dialogue | null | undefined, reponse: ReponseDialogue): string {
  if (reponse.texte !== undefined && reponse.texte.trim() !== '') return `Réponse libre : ${reponse.texte.trim()}`;
  const options = dialogue?.options ?? [];
  const indices = reponse.cases ?? (reponse.index !== undefined ? [reponse.index] : []);
  const libelles = indices.map((i) => options[i]?.libelle ?? `option ${i + 1}`);
  return libelles.length > 0 ? `Choix retenu : ${libelles.join(', ')}` : 'Réponse reçue';
}
