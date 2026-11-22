// Responsabilité : brancher « Ajouter une machine au réseau » sur les services du relais (SSH, machines configurées,
// fédération, codes, registre, diffusion). Aucune règle ici : seulement l'assemblage.
import type { Logger } from 'pino';
import type { Diffusion } from '../clients/diffusion.ts';
import type { CodesReseau } from '../codes-reseau/codes-reseau.ts';
import type { Federation } from '../federation/federation.ts';
import type { RegistreMachines } from '../machines/registre-machines.ts';
import type { Ssh } from '../machines/ssh.ts';
import type { Registre } from '../registre/registre.ts';
import { AjoutNoeud } from './ajout-noeud.ts';
import { cheminBinaire, lireSources } from './binaire.ts';

export interface ServicesAjout {
  readonly ssh: Ssh;
  readonly machines: RegistreMachines;
  readonly federation: Federation;
  readonly codes: CodesReseau;
  readonly registre: Registre;
  readonly diffusion: Diffusion;
  /** Archive du code des postes du moteur (LANTERNE_MOTEUR_CODE_POSTE) ; null hors moteur Lanterne. */
  readonly codePoste: string | null;
  readonly journal: Logger;
}

export function creerAjoutNoeud(s: ServicesAjout): AjoutNoeud {
  return new AjoutNoeud({
    ssh: s.ssh,
    connexionDe: (id) => {
      const c = s.machines.lire(id);
      return c ? { hote: c.hote, port: c.port, utilisateur: c.utilisateur, cle: c.cle } : null;
    },
    federation: {
      etat: () => s.federation.etat(),
      decider: (id, accord) => s.federation.decider(id, accord),
      revoquer: (membre) => s.federation.revoquer(membre),
      sessionsDe: (membre) =>
        s.federation.distantes
          .sessions()
          .filter((d) => d.membre === membre)
          .map((d) => d.session),
    },
    creerCode: () => s.codes.creer({ genre: 'meme_proprietaire' }),
    sources: () => lireSources(cheminBinaire(), s.codePoste),
    sessionsLocales: () => s.registre.sessions(true),
    // Le même chemin qu'un clic dans l'appli : la requête est relayée au nœud qui tient la session.
    epingler: async (id) => {
      const req = new Request(`http://noeud/api/sessions/${encodeURIComponent(id)}/epingler`, { method: 'POST' });
      const r = await s.federation.distantes.intercepter(req);
      return r?.ok ?? false;
    },
    signaler: () => s.diffusion.diffuser({ type: 'federation_modifiee' }),
    journal: s.journal,
  });
}
