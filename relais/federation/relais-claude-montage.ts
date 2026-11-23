// Responsabilité : le montage du relais Claude d'un nœud (`RelaisClaude`) à partir du port du nœud et de sa politique
// d'invités — des branchements seulement : la logique est dans relais/invites.
import { DELAI_PREMIER_OCTET_MS, URL_API_PAR_DEFAUT } from '../../commun/relais-claude.ts';
import type { NoeudInvites } from '../invites/noeud-invites.ts';
import { RelaisClaude } from '../invites/relais-claude.ts';
import type { PortNoeud } from './noeud-port.ts';

export type { RelaisClaude };

export function montarRelaisClaude(port: PortNoeud, invites: NoeudInvites): RelaisClaude {
  const { options } = port;
  const journal = options.journal.child({ domaine: 'relais-claude' });
  let jeton: string | null = null;
  const moi = (): string | null => port.config()?.id ?? null;
  return new RelaisClaude({
    client: {
      moi,
      reglagesDe: (membre) => invites.reglagesDe(membre),
      canalVers: (membre) => port.canaux.liaisonOuverteAvec(membre),
      jetonRelais: () => (jeton ??= port.secrets.jetonRelaisClaude()),
      delaiPremierOctetMs: options.delaiClaudeMs ?? DELAI_PREMIER_OCTET_MS,
      journal,
    },
    serveur: {
      moi,
      reglagesDe: (membre) => invites.reglagesDe(membre),
      partDe: (membre, reglages) => invites.partDe(membre, reglages),
      jetonAbonnement: options.jetonAbonnement ?? (() => null),
      urlApi: options.urlApiClaude ?? URL_API_PAR_DEFAUT,
      fetch: options.fetchClaude ?? fetch,
      debutRequete: () => invites.debutRelais(),
      finRequete: (membre, debut, conso, nouvelle) => invites.finRelais(membre, debut, conso, nouvelle),
      journal,
    },
    suivi: invites.suivi,
    journal,
  });
}
