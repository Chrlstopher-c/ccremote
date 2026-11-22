// Responsabilité : les liaisons directes du nœud — écoute sur une adresse (réseau local, VPN, tunnel SSH), liaisons
// sortantes vers les adresses connues des pairs, une seule liaison par pair (en cas de doublon, celle que lance le plus
// petit identifiant garde). Sans aiguilleur, c'est par elles que les nœuds se joignent ; le protocole n'y change rien.
import type { Logger } from 'pino';
import type { Server } from 'bun';
import { exporterIdentitePublique } from '../../commun/chiffrement/identite.ts';
import { type MessageDeAiguilleur, TAILLE_MAX_TRAME_OCTETS } from '../../commun/aiguilleur.ts';
import { type ConfigDirecte, type PairFederee } from './secrets.ts';
import { type Locale, type PresentationDirecte } from './direct-poignee.ts';
import { LienDirect, type SortieLien } from './direct-lien.ts';
import { TunnelSsh, type TunnelSshConfig, tunnelSshValide } from './tunnel-ssh.ts';

export const CHEMIN_DIRECT = '/direct';
const ADRESSE = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9._-]+):(\d{1,5})$/;

/** Adresse `hôte:port` valide (port 0 accepté pour une écoute éphémère). */
export function adresseDirecteValide(brut: string): boolean {
  const m = ADRESSE.exec(brut.trim());
  return m !== null && Number(m[2]) <= 65535;
}

export interface OptionsNoeudDirect {
  readonly journal: Logger;
  readonly config: ConfigDirecte;
  readonly sauver: (config: ConfigDirecte) => void;
  readonly locale: () => Locale | null;
  readonly pairs: () => readonly PairFederee[];
  readonly ouvert: (lien: LienDirect) => void;
  readonly ferme: (lien: LienDirect) => void;
  readonly message: (lien: LienDirect, message: MessageDeAiguilleur) => void;
  /** Commande ssh des tunnels, et known_hosts (vérifié à chaque connexion). */
  readonly commandeSsh: string;
  readonly knownHosts: string;
}

interface DonneesWs {
  lien: LienDirect | null;
}

export interface EtatLiaisonDirecte {
  readonly id: string;
  readonly nom: string;
  readonly adresse: string | null;
  readonly enLigne: boolean;
}

export class NoeudDirect {
  private serveur: Server<DonneesWs> | null = null;
  private readonly liens = new Map<string, LienDirect>();
  private readonly enCours = new Set<string>();
  private readonly attentes = new Map<LienDirect, (lien: LienDirect | null) => void>();
  private tunnels: TunnelSsh[] = [];

  constructor(private readonly options: OptionsNoeudDirect) {}

  get config(): ConfigDirecte {
    return this.options.config;
  }

  /** Démarre l'écoute si elle est configurée et rétablit les liaisons vers les pairs qui ont une adresse. */
  demarrer(): void {
    this.ecouter();
    this.demarrerTunnels();
    this.relancer();
  }

  arreter(): void {
    this.arreterTunnels();
    this.serveur?.stop(true);
    this.serveur = null;
    for (const lien of [...this.liens.values()]) lien.fermer('arrêt du nœud');
    for (const [lien, resoudre] of this.attentes) {
      resoudre(null);
      this.attentes.delete(lien);
    }
  }

  /** Port réellement écouté (utile quand la configuration demande un port 0). Null si pas d'écoute. */
  portEcoute(): number | null {
    return this.serveur?.port ?? null;
  }

  /** Change l'écoute, le propriétaire ou les tunnels, et sauvegarde. */
  configurer(corps: { ecoute?: string | null; proprietaire?: string | null; tunnels?: TunnelSshConfig[] }): void {
    const config = this.options.config;
    if (corps.ecoute !== undefined) config.ecoute = corps.ecoute;
    if (corps.proprietaire !== undefined) config.proprietaire = corps.proprietaire;
    if (corps.tunnels !== undefined) config.tunnels = corps.tunnels.filter(tunnelSshValide);
    this.options.sauver(config);
    this.serveur?.stop(true);
    this.serveur = null;
    this.ecouter();
    this.arreterTunnels();
    this.demarrerTunnels();
  }

  private demarrerTunnels(): void {
    this.tunnels = this.options.config.tunnels.filter(tunnelSshValide).map((t) => {
      const tunnel = new TunnelSsh(t, {
        commande: this.options.commandeSsh,
        knownHosts: this.options.knownHosts,
        journal: this.options.journal,
      });
      tunnel.demarrer();
      return tunnel;
    });
  }

  private arreterTunnels(): void {
    for (const tunnel of this.tunnels) tunnel.arreter();
    this.tunnels = [];
  }

  /** Adresse d'un pair mémorisée (saisie ou tunnel) : celui qui la connaît rétablit la liaison. */
  retenirAdresse(id: string, adresse: string): void {
    this.options.config.adresses[id] = adresse;
    this.options.sauver(this.options.config);
  }

  oublier(id: string): void {
    if (this.options.config.adresses[id] === undefined) return;
    delete this.options.config.adresses[id];
    this.options.sauver(this.options.config);
  }

  /** Coupe la liaison avec ce pair (pair retiré du réseau). */
  fermer(id: string): void {
    this.liens.get(id)?.fermer('pair retiré');
  }

  /** Une liaison ouverte avec ce pair ? */
  joignable(id: string): boolean {
    return this.liens.get(id)?.ouvert === true;
  }

  /** Envoie un message de protocole sur la liaison ouverte avec ce pair. Null si aucune liaison ouverte. */
  envoyer(id: string, message: Parameters<LienDirect['envoyer']>[0]): boolean | null {
    const lien = this.liens.get(id);
    if (!lien?.ouvert) return null;
    return lien.envoyer(message);
  }

  /** Ouvre une liaison vers une adresse ; résout avec la liaison ouverte, ou null si elle échoue. */
  composerSortant(adresse: string, attendu: string | null): Promise<LienDirect | null> {
    const moi = this.options.locale();
    if (!moi || !adresseDirecteValide(adresse)) return Promise.resolve(null);
    const ws = new WebSocket(`ws://${adresse.trim()}${CHEMIN_DIRECT}`);
    const sortie: SortieLien = {
      envoyerBrut: (texte) => (ws.readyState === WebSocket.OPEN ? (ws.send(texte), true) : false),
      fermer: () => ws.close(1000, 'fin'),
    };
    const lien = new LienDirect(sortie, moi, 'sortant', this.handlers(), this.options.journal, attendu);
    return new Promise<LienDirect | null>((resoudre) => {
      this.attentes.set(lien, resoudre);
      ws.onopen = () => lien.demarrer();
      ws.onmessage = (ev) => lien.recevoirBrut(String(ev.data));
      ws.onclose = () => lien.fermer('connexion coupée');
      ws.onerror = () => undefined;
    });
  }

  /** Relance les liaisons vers les pairs dont on connaît l'adresse et qui ne sont pas reliés. */
  relancer(): void {
    for (const pair of this.options.pairs()) {
      const adresse = this.options.config.adresses[pair.id];
      if (adresse === undefined || this.liens.has(pair.id) || this.enCours.has(pair.id)) continue;
      this.enCours.add(pair.id);
      void this.composerSortant(adresse, pair.id).finally(() => this.enCours.delete(pair.id));
    }
  }

  etat(): {
    ecoute: string | null;
    ecouteReelle: number | null;
    proprietaire: string | null;
    tunnels: { adresse: string; actif: boolean }[];
  } {
    return {
      ecoute: this.options.config.ecoute,
      ecouteReelle: this.portEcoute(),
      proprietaire: this.options.config.proprietaire,
      tunnels: this.tunnels.map((t) => ({ adresse: t.adresseLocale, actif: t.actif })),
    };
  }

  liaisons(): EtatLiaisonDirecte[] {
    return this.options.pairs()
      .filter((p) => p.genre === 'noeud')
      .map((p) => ({
        id: p.id,
        nom: p.nom,
        adresse: this.options.config.adresses[p.id] ?? null,
        enLigne: this.joignable(p.id),
      }));
  }

  private ecouter(): void {
    const ecoute = this.options.config.ecoute;
    if (!ecoute || !adresseDirecteValide(ecoute) || this.serveur) return;
    const m = ADRESSE.exec(ecoute.trim());
    if (!m) return;
    const hote = (m[1] ?? '').replace(/^\[|\]$/g, '');
    try {
      this.serveur = Bun.serve<DonneesWs>({
        hostname: hote,
        port: Number(m[2]),
        fetch: (requete, serveur) => {
          if (new URL(requete.url).pathname === CHEMIN_DIRECT && serveur.upgrade(requete, { data: { lien: null } })) {
            return undefined;
          }
          return new Response('introuvable', { status: 404 });
        },
        websocket: {
          maxPayloadLength: TAILLE_MAX_TRAME_OCTETS,
          open: (ws) => {
            const lien = this.entrant(ws);
            ws.data.lien = lien;
            lien?.demarrer();
          },
          message: (ws, message) => ws.data.lien?.recevoirBrut(String(message)),
          close: (ws) => ws.data.lien?.fermer('connexion coupée'),
        },
      });
      this.options.journal.info({ port: this.serveur.port }, 'liaisons directes : écoute ouverte');
    } catch (erreur) {
      this.options.journal.error({ err: erreur }, 'liaisons directes : écoute impossible');
    }
  }

  private entrant(ws: { send(texte: string): number; close(code?: number, motif?: string): void }): LienDirect | null {
    const moi = this.options.locale();
    if (!moi) return null;
    const sortie: SortieLien = {
      envoyerBrut: (texte) => ws.send(texte) > 0,
      fermer: () => ws.close(1000, 'fin'),
    };
    return new LienDirect(sortie, moi, 'entrant', this.handlers(), this.options.journal, null);
  }

  private handlers() {
    return {
      admettre: (lien: LienDirect, p: PresentationDirecte) => this.admettre(lien, p),
      surMessage: (lien: LienDirect, m: MessageDeAiguilleur) => this.options.message(lien, m),
      surOuvert: (lien: LienDirect) => this.ouvert(lien),
      surFerme: (lien: LienDirect, etaitOuvert: boolean) => this.ferme(lien, etaitOuvert),
    };
  }

  // Un pair connu doit présenter l'identité enregistrée sous son identifiant ; un doublon se règle au plus petit
  // identifiant : la liaison lancée par lui est gardée, l'autre se ferme.
  private admettre(lien: LienDirect, p: PresentationDirecte): boolean {
    const moi = this.options.locale()?.id;
    if (!moi || p.id === moi) return false;
    const texte = exporterIdentitePublique(p.identite);
    const connu = this.options.pairs().find((x) => x.id === p.id);
    if (connu && connu.identite !== texte) return false;
    if (this.options.pairs().some((x) => x.identite === texte && x.id !== p.id)) return false;
    const existant = this.liens.get(p.id);
    if (!existant || existant === lien || !existant.ouvert) return true;
    const lanceur = lien.sens === 'sortant' ? moi : p.id;
    if (lanceur !== (moi < p.id ? moi : p.id)) return false;
    existant.fermer('doublon : liaison gardée par l’autre');
    return true;
  }

  private ouvert(lien: LienDirect): void {
    const id = lien.pair?.id;
    if (!id) return;
    this.liens.set(id, lien);
    this.attentes.get(lien)?.(lien);
    this.attentes.delete(lien);
    this.options.ouvert(lien);
  }

  private ferme(lien: LienDirect, etaitOuvert: boolean): void {
    const id = lien.pair?.id;
    if (id !== undefined && this.liens.get(id) === lien) this.liens.delete(id);
    this.attentes.get(lien)?.(null);
    this.attentes.delete(lien);
    if (etaitOuvert) this.options.ferme(lien);
  }
}
