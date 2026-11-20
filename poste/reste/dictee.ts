// Responsabilité : la dictée du poste (P6) — client du démon de dictée local (protocole v1, une ligne JSON par message,
// audio PCM 16 kHz mono s16 encodé en base64) : ping pour l'état, puis ouvrir → audio par morceaux de 1 s → fermer,
// jusqu'à l'événement `final`. Le démon n'est jamais lancé d'ici : il tourne ou il ne tourne pas.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import {
  DELAI_DICTEE_MS,
  DELAI_ETAT_DICTEE_MS,
  type EtatDicteePoste,
  type ReponseDicteePoste,
} from '../../commun/reste-lot2.ts';

/** 1 s de PCM 16 kHz mono 16 bits : la taille d'un morceau envoyé au démon. */
export const OCTETS_MORCEAU_AUDIO = 32_000;

type Evenement = Readonly<Record<string, unknown>>;

/** Socket du démon : `LANTERNE_DICTEE_SOCKET`, sinon `$XDG_RUNTIME_DIR/dictee/moteur.sock`. */
export function cheminSocketDictee(env: Readonly<Record<string, string | undefined>>, uid: number | undefined): string {
  const explicite = env['LANTERNE_DICTEE_SOCKET'];
  if (explicite) return explicite;
  const base = env['XDG_RUNTIME_DIR'] || `/run/user/${uid ?? 0}`;
  return join(base, 'dictee', 'moteur.sock');
}

/** Découpe l'audio en morceaux de `taille` octets (le dernier peut être plus court). */
export function decouperAudio(octets: Uint8Array, taille: number = OCTETS_MORCEAU_AUDIO): Uint8Array[] {
  const morceaux: Uint8Array[] = [];
  for (let i = 0; i < octets.length; i += taille) morceaux.push(octets.subarray(i, i + taille));
  return morceaux;
}

/** L'état du service : un ping répond `pong`, un socket absent ou muet dit pourquoi. */
export async function etatDictee(chemin: string, journal: Logger): Promise<EtatDicteePoste> {
  if (!existsSync(chemin)) return { disponible: false, raison: 'service de dictée absent de ce poste' };
  try {
    await dialoguer(chemin, ['{"op":"ping"}'], (e) => (e['ev'] === 'pong' ? true : undefined), DELAI_ETAT_DICTEE_MS);
    return { disponible: true, raison: null };
  } catch (erreur) {
    journal.warn({ err: erreur }, 'dictée : service de ce poste injoignable');
    return { disponible: false, raison: 'service de dictée injoignable' };
  }
}

/** Transcrit un audio PCM 16 bits (base64) : session neuve, morceaux de 1 s, `final` attendu. */
export async function transcrire(
  chemin: string,
  pcm16: string,
  langue: string,
  journal: Logger,
): Promise<ReponseDicteePoste> {
  const octets = Buffer.from(pcm16, 'base64');
  if (octets.length === 0 || octets.length % 2 !== 0) {
    return { etat: 'erreur', raison: 'audio PCM 16 bits attendu (octets pairs, non vide)' };
  }
  const session = `dictee-${randomUUID()}`;
  const debut = Date.now();
  const lignes = [
    JSON.stringify({ op: 'ouvrir', session, langue }),
    ...decouperAudio(octets).map((m) =>
      JSON.stringify({ op: 'audio', session, pcm16: Buffer.from(m).toString('base64') }),
    ),
    JSON.stringify({ op: 'fermer', session }),
  ];
  try {
    const texte = await dialoguer(chemin, lignes, (e) => lireFinal(e, session), DELAI_DICTEE_MS);
    return { etat: 'ok', texte, ms: Date.now() - debut };
  } catch (erreur) {
    journal.warn({ err: erreur }, 'dictée : transcription en échec');
    return { etat: 'erreur', raison: erreur instanceof Error ? erreur.message : String(erreur) };
  }
}

// Le `final` de notre session ; une `erreur` du démon (la nôtre ou sans session) interrompt la lecture.
function lireFinal(e: Evenement, session: string): string | undefined {
  if (e['ev'] === 'erreur' && (e['session'] === session || e['session'] === null || e['session'] === undefined)) {
    throw new Error(String(e['message'] ?? 'erreur du service de dictée'));
  }
  if (e['ev'] === 'final' && e['session'] === session) {
    return typeof e['texte'] === 'string' ? e['texte'] : '';
  }
  return undefined;
}

/** Envoie `lignes`, puis lit les événements jusqu'à ce que `lire` rende une valeur ; `lire` peut lever une erreur. */
function dialoguer<T>(
  chemin: string,
  lignes: readonly string[],
  lire: (e: Evenement) => T | undefined,
  delaiMs: number,
): Promise<T> {
  return new Promise<T>((resoudre, rejeter) => {
    let fini = false;
    let reste = Buffer.alloc(0);
    // Octets pas encore acceptés par le noyau : `write` rend le nombre écrit, la suite part au `drain`.
    let envoi = Buffer.from(lignes.map((l) => `${l}\n`).join(''));
    let connexion: { end(): void; write(donnees: Uint8Array): number } | null = null;
    const pousser = (s: { write(donnees: Uint8Array): number }): void => {
      while (!fini && envoi.length > 0) {
        const ecrits = s.write(envoi);
        if (ecrits <= 0) return;
        envoi = envoi.subarray(ecrits);
      }
    };
    const termine = (suite: () => void): void => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      connexion?.end();
      suite();
    };
    const minuterie = setTimeout(
      () => termine(() => rejeter(new Error('pas de réponse du service de dictée'))),
      delaiMs,
    );
    const traiter = (ligne: string): void => {
      try {
        const evenement = JSON.parse(ligne) as Evenement;
        const valeur = lire(evenement);
        if (valeur !== undefined) termine(() => resoudre(valeur));
      } catch (erreur) {
        termine(() => rejeter(erreur));
      }
    };
    Bun.connect({
      unix: chemin,
      socket: {
        open: (s) => {
          connexion = s;
          if (fini) {
            s.end();
            return;
          }
          pousser(s);
        },
        drain: (s) => pousser(s),
        data: (_s, octets) => {
          reste = Buffer.concat([reste, Buffer.from(octets)]);
          for (let fin = reste.indexOf(0x0a); fin >= 0 && !fini; fin = reste.indexOf(0x0a)) {
            const ligne = reste.subarray(0, fin).toString('utf8');
            reste = reste.subarray(fin + 1);
            if (ligne.trim() !== '') traiter(ligne);
          }
        },
        error: (_s, erreur) => termine(() => rejeter(erreur)),
        close: () => termine(() => rejeter(new Error('connexion au service de dictée fermée'))),
      },
    }).catch((erreur: unknown) => termine(() => rejeter(erreur)));
  });
}
