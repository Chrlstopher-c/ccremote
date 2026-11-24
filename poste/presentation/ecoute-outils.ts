// Responsabilité : l'écoute, côté poste, des outils de modules pour les sessions Claude Code ouvertes hors de
// Lanterne — un socket Unix en 0600 dans le dossier d'exécution de l'utilisateur. Chaque ligne valide (liste blanche, taille
// bornée) est relayée au relais par le lien du poste ; la réponse revient à l'id de la requête. Le reste est refusé.
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import type { Socket } from 'bun';
import type { QuoiRelais, ReponseRelais } from '../../commun/modules.ts';
import {
  argsRelais,
  cheminSocketOutils,
  type DemandeOutils,
  decoderDemande,
  ligneReponse,
  MESSAGE_SESSION_REFUSEE,
  TAILLE_MAX_LIGNE_OUTILS,
} from './socket-outils.ts';

export type RelaisOutils = (quoi: QuoiRelais, args: unknown) => Promise<ReponseRelais>;

export interface EcouteOutils {
  arreter(): void;
}

/** Vrai si la session désignée est pilotée par ce poste et vivante (seule condition pour transmettre sa session). */
export type SessionVivante = (id: string) => boolean;

interface ParametresEcoute {
  readonly chemin: string;
  readonly relais: RelaisOutils;
  readonly journal: Logger;
  readonly sessionVivante: SessionVivante;
}

interface Connexion {
  tampon: string;
  decodeur: TextDecoder;
}

type Prise = Socket<Connexion>;

/** Socket du poste pour les outils hors Lanterne ; absent ou impossible à ouvrir : null, le poste démarre sans lui. */
export function demarrerOutilsHorsLanterne(
  donnees: string,
  relais: RelaisOutils,
  journal: Logger,
  sessionVivante: SessionVivante,
): EcouteOutils | null {
  const chemin = cheminSocketOutils(process.env, process.getuid?.(), donnees);
  try {
    return demarrerEcouteOutils({ chemin, relais, journal, sessionVivante });
  } catch (erreur) {
    journal.error({ err: erreur, chemin }, 'outils hors Lanterne indisponibles');
    return null;
  }
}

export function demarrerEcouteOutils(p: ParametresEcoute): EcouteOutils {
  preparerChemin(p.chemin, p.journal);
  const serveur = Bun.listen<Connexion>({
    unix: p.chemin,
    socket: {
      open: (s) => {
        s.data = { tampon: '', decodeur: new TextDecoder() };
      },
      data: (s, octets) => recevoir(s, octets, p),
      error: (_s, erreur) => p.journal.error({ err: erreur }, 'écoute des outils hors Lanterne en erreur'),
    },
  });
  chmodSync(p.chemin, 0o600);
  p.journal.info({ chemin: p.chemin }, 'outils hors Lanterne à l’écoute');
  return { arreter: () => arreterEcoute(serveur, p) };
}

/** Le dossier est privé ; un socket périmé est remplacé, un fichier ordinaire n'est jamais effacé. */
function preparerChemin(chemin: string, journal: Logger): void {
  mkdirSync(dirname(chemin), { recursive: true, mode: 0o700 });
  if (!existsSync(chemin)) return;
  if (!lstatSync(chemin).isSocket()) throw new Error(`${chemin} existe et n’est pas un socket : rien n’est effacé`);
  journal.info({ chemin }, 'socket périmée d’un lancement précédent : remplacée');
  unlinkSync(chemin);
}

function arreterEcoute(serveur: { stop(fermer?: boolean): void }, p: ParametresEcoute): void {
  serveur.stop(true);
  if (existsSync(p.chemin)) unlinkSync(p.chemin);
  p.journal.info('outils hors Lanterne arrêtés');
}

function recevoir(s: Prise, octets: Buffer, p: ParametresEcoute): void {
  s.data.tampon += s.data.decodeur.decode(octets, { stream: true });
  for (let fin = s.data.tampon.indexOf('\n'); fin !== -1; fin = s.data.tampon.indexOf('\n')) {
    const ligne = s.data.tampon.slice(0, fin);
    s.data.tampon = s.data.tampon.slice(fin + 1);
    if (Buffer.byteLength(ligne) > TAILLE_MAX_LIGNE_OUTILS) {
      refuserEtFermer(s, p, 'ligne trop longue');
      return;
    }
    if (ligne.trim() !== '') void traiter(s, ligne, p);
  }
  if (Buffer.byteLength(s.data.tampon) > TAILLE_MAX_LIGNE_OUTILS) refuserEtFermer(s, p, 'ligne trop longue');
}

async function traiter(s: Prise, ligne: string, p: ParametresEcoute): Promise<void> {
  const lue = decoderDemande(ligne);
  if (!lue.ok) {
    refuser(s, p, lue.id, lue.erreur);
    return;
  }
  if (lue.demande.session !== undefined && !p.sessionVivante(lue.demande.session)) {
    refuser(s, p, lue.demande.id, MESSAGE_SESSION_REFUSEE);
    return;
  }
  const r = await relayer(lue.demande, p);
  s.write(ligneReponse(lue.demande.id, r));
}

async function relayer(demande: DemandeOutils, p: ParametresEcoute): Promise<ReponseRelais> {
  try {
    return await p.relais(demande.quoi, argsRelais(demande));
  } catch (erreur) {
    p.journal.error({ err: erreur, operation: demande.quoi }, 'relais des outils hors Lanterne en échec');
    return { ok: false, erreur: 'requête au relais en échec' };
  }
}

function refuser(s: Prise, p: ParametresEcoute, id: string | null, erreur: string): void {
  p.journal.warn({ id, raison: erreur }, 'outil hors Lanterne refusé');
  s.write(ligneReponse(id, { ok: false, erreur }));
}

function refuserEtFermer(s: Prise, p: ParametresEcoute, erreur: string): void {
  refuser(s, p, null, erreur);
  s.end();
}
