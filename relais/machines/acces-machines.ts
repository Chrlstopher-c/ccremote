// Responsabilité : fournir à la vue des machines leur accès (tunnel, installation, connexion du poste), et les
// fiches des machines configurées que le relais ne connaît pas encore (état non_installe).
import type { AccesVue, VueInstallation, VueMachine } from '../../commun/api-clients.ts';
import { avancerAcces, calculerAcces } from './etat-acces.ts';
import type { MachineConfiguree } from './registre-machines.ts';

export interface DependancesAcces {
  readonly configurations: () => MachineConfiguree[];
  readonly installee: (id: string) => boolean;
  readonly tunnel: (id: string) => { readonly ouvert: boolean; readonly detail: string | null };
  readonly enLigne: (id: string) => boolean;
  readonly connue: (id: string) => boolean; // une fiche de poste existe déjà dans le relais
  readonly installation: (id: string) => VueInstallation | null;
  readonly maintenant?: () => string;
}

export class AccesMachines {
  private readonly memo = new Map<string, AccesVue>();

  constructor(private readonly d: DependancesAcces) {}

  installation(id: string): VueInstallation | null {
    return this.d.installation(id);
  }

  /** L'accès courant d'une machine ; le moment du changement est noté ici, à chaque calcul. */
  de(id: string): AccesVue {
    const configuree = this.d.configurations().some((c) => c.id === id);
    const tunnel = this.d.tunnel(id);
    const calcule = calculerAcces({
      configuree,
      installee: this.d.installee(id),
      posteEnLigne: this.d.enLigne(id),
      tunnelOuvert: tunnel.ouvert,
      detailTunnel: tunnel.detail,
    });
    const maintenant = this.d.maintenant ? this.d.maintenant() : new Date().toISOString();
    const suivant = avancerAcces(this.memo.get(id), calcule, maintenant);
    this.memo.set(id, suivant);
    return suivant;
  }

  /** Machines configurées sans fiche de poste : elles figurent dans la liste, hors ligne, avec leur état d'accès. */
  sansPoste(): VueMachine[] {
    return this.d
      .configurations()
      .filter((c) => !this.d.connue(c.id))
      .map((c) => ({
        id: c.id,
        description: c.description,
        racines: [],
        projets: [],
        comptes: [],
        etatComptes: [],
        version: '',
        etat: null,
        derniereVue: '',
        enLigne: false,
        acces: this.de(c.id),
        installation: this.d.installation(c.id),
      }));
  }
}
