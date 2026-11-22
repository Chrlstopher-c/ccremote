// Responsabilité : commandes locales de l'aiguilleur, lancées sur sa machine avec son fichier d'environnement —
// `appairer <propriétaire>` (code à usage unique), `membres`, `revoquer <id>`, `lier-duo <A> <B>`. Elles écrivent dans
// l'annuaire ; le processus de l'aiguilleur les prend en compte au balayage suivant (jamais de réponse ouverte).
import { codeAppairageNeuf } from '../acces/appairage.ts';
import { cheminAnnuaire } from '../config.ts';
import { VALIDE_IDENTIFIANT } from '../../commun/aiguilleur.ts';
import { ouvrirAnnuaire } from './annuaire-base.ts';
import { Annuaire, type Membre } from './annuaire.ts';

const AIDE = `usage :
  bun run relais/aiguilleur/commande.ts appairer <propriétaire>
  bun run relais/aiguilleur/commande.ts membres
  bun run relais/aiguilleur/commande.ts revoquer <identifiant>
  bun run relais/aiguilleur/commande.ts lier-duo <propriétaire A> <propriétaire B>`;

const VALIDE_PROPRIETAIRE = /^[a-z0-9-]{1,40}$/;

/** Exécute une commande sur l'annuaire et rend ce qu'elle affiche. Une commande inconnue ou mal formée lève l'aide. */
export function executerCommande(argv: readonly string[], annuaire: Annuaire): string {
  const [commande, ...args] = argv;
  if (commande === 'appairer' && args.length === 1) return appairer(annuaire, proprietaire(args[0]));
  if (commande === 'membres' && args.length === 0) return lister(annuaire);
  if (commande === 'revoquer' && args.length === 1) return revoquer(annuaire, args[0] ?? '');
  if (commande === 'lier-duo' && args.length === 2)
    return lierDuo(annuaire, proprietaire(args[0]), proprietaire(args[1]));
  throw new Error(AIDE);
}

function proprietaire(brut: string | undefined): string {
  if (!brut || !VALIDE_PROPRIETAIRE.test(brut))
    throw new Error('propriétaire : minuscules, chiffres et tirets (40 max)');
  return brut;
}

function appairer(annuaire: Annuaire, prop: string): string {
  const c = codeAppairageNeuf();
  annuaire.creerCodeAppairage(prop, c.empreinte, c.expireLe);
  return `${c.code}\nvalable jusqu’à ${c.expireLe} (usage unique, propriétaire « ${prop} »)`;
}

function lister(annuaire: Annuaire): string {
  const membres = annuaire.membres();
  if (membres.length === 0) return 'aucun membre appairé';
  return membres.map(ligneMembre).join('\n');
}

function ligneMembre(m: Membre): string {
  const etat = m.revoqueLe ? `révoqué le ${m.revoqueLe}` : 'actif';
  return `${m.id}  ${m.genre.padEnd(8)}  ${m.proprietaire}  ${m.nom}  (${etat})`;
}

function revoquer(annuaire: Annuaire, id: string): string {
  if (!VALIDE_IDENTIFIANT.test(id)) throw new Error('identifiant de membre invalide (12 caractères hexadécimaux)');
  if (!annuaire.revoquer(id)) throw new Error(`membre « ${id} » inconnu ou déjà révoqué`);
  return `« ${id} » révoqué : ses liens sont coupés au balayage suivant (2 s au plus)`;
}

function lierDuo(annuaire: Annuaire, a: string, b: string): string {
  if (a === b) throw new Error('un duo lie deux propriétaires distincts');
  annuaire.lierDuo(a, b);
  return `duo déclaré entre « ${a} » et « ${b} »`;
}

if (import.meta.main) {
  try {
    const db = ouvrirAnnuaire(cheminAnnuaire(process.env));
    try {
      console.log(executerCommande(process.argv.slice(2), new Annuaire(db)));
    } finally {
      db.close();
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
