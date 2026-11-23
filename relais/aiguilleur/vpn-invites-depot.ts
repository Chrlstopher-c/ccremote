// Responsabilité : le dépôt d'une demande VPN dans le dossier partagé avec le service root, et l'attente de sa réponse.
// Écriture atomique (fichier temporaire puis renommage), fichiers en 0600. Seule la clé publique passe par ici.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { type DemandeVpnInvite, ReponseRootVpn } from '../../commun/aiguilleur.ts';

const INTERVALLE_LECTURE_MS = 200;

export function deposerDemande(dossier: string, demande: DemandeVpnInvite): void {
  const temporaire = join(dossier, `.${demande.id}.tmp`);
  writeFileSync(temporaire, JSON.stringify(demande), { mode: 0o600 });
  renameSync(temporaire, join(dossier, `${demande.id}.demande.json`));
}

/** La réponse du service root, ou null si elle n'est pas arrivée dans le délai. */
export async function attendreReponse(
  dossier: string,
  id: string,
  delaiMs: number,
  journal: Logger,
): Promise<ReponseRootVpn | null> {
  const fin = Date.now() + delaiMs;
  for (;;) {
    const lue = lireReponse(dossier, id, journal);
    if (lue !== null) return lue;
    if (Date.now() >= fin) return null;
    await new Promise((resoudre) => setTimeout(resoudre, INTERVALLE_LECTURE_MS));
  }
}

function lireReponse(dossier: string, id: string, journal: Logger): ReponseRootVpn | null {
  const chemin = join(dossier, `${id}.reponse.json`);
  if (!existsSync(chemin)) return null;
  try {
    const brut: unknown = JSON.parse(readFileSync(chemin, 'utf8'));
    const lue = ReponseRootVpn.safeParse(brut);
    if (lue.success) return lue.data;
    journal.error({ id }, 'vpn : réponse du service root non conforme');
    return { ok: false, raison: 'réponse du service VPN non conforme' };
  } catch (erreur) {
    journal.error({ err: erreur, id }, 'vpn : réponse du service root illisible');
    return { ok: false, raison: 'réponse du service VPN illisible' };
  }
}

/** Retire la demande et la réponse d'un identifiant (fin de requête, réponse lue ou délai dépassé). */
export function retirerFichiers(dossier: string, id: string, journal: Logger): void {
  try {
    rmSync(join(dossier, `${id}.demande.json`), { force: true });
    rmSync(join(dossier, `${id}.reponse.json`), { force: true });
  } catch (erreur) {
    journal.error({ err: erreur, id }, 'vpn : fichiers de demande non retirés');
  }
}
