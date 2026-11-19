// Responsabilité : exécuter sur ce poste les commandes de configuration reçues du relais (styles, instructions,
// compétences, connecteurs, plug-ins). Rien ici ne touche une session : c'est la configuration de la machine.
import type { Logger } from 'pino';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import { ecrireInstructions, lireInstructions } from './instructions.ts';
import { creerStyle, type ResultatStyle } from './styles.ts';
import { listerCompetences, lireCompetence } from './competences.ts';
import { type ListeurConnecteurs } from './connecteurs.ts';
import {
  ajouterConnecteur,
  definitionDe,
  lireBrutConnecteur,
  modifierConnecteur,
  type ResultatEdition,
  retirerConnecteur,
} from './connecteurs-edition.ts';
import type { LanceurClaude } from './exec.ts';
import { activerPlugin, lirePlugins, pluginAffiche } from './plugins.ts';

export type CommandeConfiguration = Extract<
  CommandeRelais,
  {
    kind:
      | 'styles_creer'
      | 'instructions_lire'
      | 'instructions_ecrire'
      | 'competences_lister'
      | 'competences_contenu'
      | 'connecteurs_machine'
      | 'connecteur_lire'
      | 'connecteur_ajouter'
      | 'connecteur_modifier'
      | 'connecteur_retirer'
      | 'plugins_lister'
      | 'plugin_activer';
  }
>;

const GENRES: ReadonlySet<string> = new Set([
  'styles_creer',
  'instructions_lire',
  'instructions_ecrire',
  'competences_lister',
  'competences_contenu',
  'connecteurs_machine',
  'connecteur_lire',
  'connecteur_ajouter',
  'connecteur_modifier',
  'connecteur_retirer',
  'plugins_lister',
  'plugin_activer',
]);

export function estCommandeConfiguration(c: CommandeRelais): c is CommandeConfiguration {
  return GENRES.has(c.kind);
}

export interface DependancesConfiguration {
  readonly dossierConfig: string; // ~/.claude de la machine (CLAUDE.md, skills, output-styles)
  readonly lancer: LanceurClaude;
  readonly connecteurs: ListeurConnecteurs;
  readonly recharger: () => void; // rechargement des styles dans les sessions vivantes
  readonly journal: Logger;
}

export interface ReponseConfiguration {
  readonly ok: boolean;
  readonly erreur?: string;
  readonly donnees?: unknown;
}

export async function executerConfiguration(
  c: CommandeConfiguration,
  d: DependancesConfiguration,
): Promise<ReponseConfiguration> {
  if (estCommandeConnecteur(c)) return executerConnecteur(c, d);
  switch (c.kind) {
    case 'styles_creer':
      return versStyle(creerStyle(d.dossierConfig, c, d.journal), d);
    case 'instructions_lire':
      return { ok: true, donnees: lireInstructions(d.dossierConfig, d.journal) };
    case 'instructions_ecrire': {
      const r = ecrireInstructions(d.dossierConfig, c.contenu, c.empreinte_avant, d.journal);
      return r.ok ? { ok: true, donnees: { empreinte: r.empreinte } } : { ok: false, erreur: r.erreur };
    }
    case 'competences_lister':
      return {
        ok: true,
        donnees: listerCompetences(d.dossierConfig, await lirePlugins(d.lancer, d.journal), d.journal),
      };
    case 'competences_contenu':
      return contenuCompetence(c.chemin, d);
    case 'connecteurs_machine': {
      const r = await d.connecteurs.lister();
      return r.ok ? { ok: true, donnees: r.connecteurs } : { ok: false, erreur: r.erreur };
    }
    case 'plugins_lister':
      return { ok: true, donnees: (await lirePlugins(d.lancer, d.journal)).map((p) => pluginAffiche(p, d.journal)) };
    case 'plugin_activer': {
      const r = await activerPlugin(d.lancer, c.plugin, c.actif, d.journal);
      return r.ok ? { ok: true, donnees: r.plugin } : { ok: false, erreur: r.erreur };
    }
  }
}

function versStyle(r: ResultatStyle, d: DependancesConfiguration): ReponseConfiguration {
  if (!r.ok) return { ok: false, erreur: r.erreur };
  d.recharger();
  return { ok: true, donnees: { nom: r.nom } };
}

async function contenuCompetence(chemin: string, d: DependancesConfiguration): Promise<ReponseConfiguration> {
  const plugins = await lirePlugins(d.lancer, d.journal);
  const r = lireCompetence(d.dossierConfig, plugins, chemin, d.journal);
  return r.ok ? { ok: true, donnees: { contenu: r.contenu } } : { ok: false, erreur: r.erreur };
}

type CommandeConnecteur = Extract<
  CommandeConfiguration,
  { kind: 'connecteur_lire' | 'connecteur_ajouter' | 'connecteur_modifier' | 'connecteur_retirer' }
>;

const KINDS_CONNECTEUR: ReadonlySet<string> = new Set([
  'connecteur_lire',
  'connecteur_ajouter',
  'connecteur_modifier',
  'connecteur_retirer',
]);

function estCommandeConnecteur(c: CommandeConfiguration): c is CommandeConnecteur {
  return KINDS_CONNECTEUR.has(c.kind);
}

// Lecture : le masquage tient au poste (`reveler`). Écriture : la liste en cache est périmée, même en cas d'échec.
async function executerConnecteur(c: CommandeConnecteur, d: DependancesConfiguration): Promise<ReponseConfiguration> {
  if (c.kind === 'connecteur_lire') {
    const brut = lireBrutConnecteur(c.nom, d.journal);
    const def = brut ? definitionDe(c.nom, brut, c.reveler) : null;
    return def ? { ok: true, donnees: def } : { ok: false, erreur: `connecteur introuvable : ${c.nom}` };
  }
  const r = await ecrireConnecteur(c, d);
  d.connecteurs.invalider();
  return r.ok ? { ok: true, donnees: { nom: c.kind === 'connecteur_retirer' ? c.nom : c.definition.nom } } : r;
}

function ecrireConnecteur(c: CommandeConnecteur, d: DependancesConfiguration): Promise<ResultatEdition> {
  switch (c.kind) {
    case 'connecteur_ajouter':
      return ajouterConnecteur(d.lancer, c.definition);
    case 'connecteur_modifier':
      return modifierConnecteur(d.lancer, d.journal, c.nom, c.definition);
    case 'connecteur_retirer':
      return retirerConnecteur(d.lancer, c.nom);
    default:
      return Promise.resolve({ ok: false, erreur: 'commande inconnue' });
  }
}
