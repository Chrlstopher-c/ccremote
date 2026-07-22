/**
 * Banc d'essai RÉEL du cycle de vie des worktrees (M-32, branche F.2).
 *
 * Pourquoi ce banc est le plus important de tous : c'est le seul code du harness
 * qui **supprime** quelque chose. `InterrogateurGitReel` / `GestionnaireWorktreeGitReel`
 * shell-outent vers `git` et n'ont jamais touché un dépôt — seuls les constructeurs
 * de commande étaient testés. Une erreur ici détruit du travail, irréversiblement.
 *
 * Le critère (d) de M-32 : ☠ **travail non commité ⇒ worktree JAMAIS supprimé.**
 *
 * ☠ Aucun dépôt réel de Chris n'est touché : le banc crée ses propres dépôts jetables
 * sous le scratchpad, et ne supprime que ce qu'il a lui-même créé.
 * ☠ NE PAS transformer en `*.test.ts` : exécute de vraies commandes git.
 *
 * Usage : bun run acceptation/worktree-git-reel.ts
 */
import {
  GestionnaireCycleVieWorktree,
  GestionnaireWorktreeGitReel,
  InterrogateurGitReel,
} from '../projets/index.ts'
import type { ConfigProjet } from '../projets/index.ts'

const RACINE = `/tmp/claude-1000/-home-trinity/c97df358-b841-4cbd-abe9-02ef3a090c67/scratchpad/wt-${Date.now()}`
const DEPOT = `${RACINE}/depot`
const WORKTREES = `${RACINE}/worktrees`

function horodate(m: string): void {
  console.log(`[${new Date().toISOString()}] ${m}`)
}

/** Dépôt git jetable, avec un commit initial pour avoir une branche parente réelle. */
async function creerDepotJetable(): Promise<void> {
  await Bun.$`mkdir -p ${DEPOT} ${WORKTREES}`.quiet()
  await Bun.$`git -C ${DEPOT} init -q -b main`.quiet()
  await Bun.$`git -C ${DEPOT} config user.email banc@local`.quiet()
  await Bun.$`git -C ${DEPOT} config user.name Banc`.quiet()
  await Bun.write(`${DEPOT}/README.md`, '# dépôt jetable du banc\n')
  await Bun.$`git -C ${DEPOT} add -A`.quiet()
  await Bun.$`git -C ${DEPOT} commit -q -m "commit initial"`.quiet()
}

const projet: ConfigProjet = {
  id: 'banc',
  cheminDepot: DEPOT,
  estGit: true,
  brancheDefaut: 'main',
  budgetMaxUsd: 0,
  modeleDefaut: 'sonnet',
  deniedToolPatternsSupplementaires: [],
  agentTeamsActif: false,
  mandatType: 'banc',
  isolationGarantie: true,
  fichierSource: `${RACINE}/banc.json`,
}

await creerDepotJetable()
horodate(`dépôt jetable prêt : ${DEPOT}`)

const cycle = new GestionnaireCycleVieWorktree({
  interrogateur: new InterrogateurGitReel(),
  gestionnaire: new GestionnaireWorktreeGitReel(),
})

interface Resultat {
  readonly libelle: string
  readonly ok: boolean
  readonly detail: string
}
const resultats: Resultat[] = []

async function existe(chemin: string): Promise<boolean> {
  return await Bun.file(`${chemin}/README.md`).exists()
}

// ---------------------------------------------------------------------------
// Cas 1 — worktree PROPRE : la libération doit réellement le supprimer.
// ---------------------------------------------------------------------------
{
  const revendication = await cycle.allouer({
    projet,
    idEquipe: 'equipe-propre',
    epoch: 1,
    racineWorktrees: WORKTREES,
  })
  const cree = await existe(revendication.worktreePath)
  horodate(`cas 1 · worktree créé : ${revendication.worktreePath} (présent : ${cree})`)

  const liberee = await cycle.liberer('equipe-propre')
  const encoreLa = await existe(revendication.worktreePath)
  resultats.push({
    libelle: 'worktree propre ⇒ créé puis réellement supprimé',
    ok: cree && !encoreLa && liberee.etat === 'liberee',
    detail: `créé=${cree} · supprimé=${!encoreLa} · état=${liberee.etat}`,
  })
}

// ---------------------------------------------------------------------------
// Cas 2 — ☠ LE CAS QUI COMPTE : travail NON COMMITÉ ⇒ jamais supprimé.
// ---------------------------------------------------------------------------
{
  const revendication = await cycle.allouer({
    projet,
    idEquipe: 'equipe-sale',
    epoch: 1,
    racineWorktrees: WORKTREES,
  })
  // Du travail que personne ne doit perdre.
  await Bun.write(`${revendication.worktreePath}/travail-precieux.txt`, 'huit heures de travail\n')
  horodate('cas 2 · fichier non commité déposé dans le worktree')

  const liberee = await cycle.liberer('equipe-sale')
  const worktreeIntact = await existe(revendication.worktreePath)
  const travailIntact = await Bun.file(`${revendication.worktreePath}/travail-precieux.txt`).exists()
  resultats.push({
    libelle: '☠ travail non commité ⇒ worktree CONSERVÉ et travail intact',
    ok: worktreeIntact && travailIntact && liberee.etat === 'terminee_non_liberee',
    detail: `worktree=${worktreeIntact} · travail=${travailIntact} · état=${liberee.etat}`,
  })
}

// ---------------------------------------------------------------------------
// Cas 3 — commit non intégré dans la branche parente ⇒ jamais supprimé non plus.
// ---------------------------------------------------------------------------
{
  const revendication = await cycle.allouer({
    projet,
    idEquipe: 'equipe-commit',
    epoch: 1,
    racineWorktrees: WORKTREES,
  })
  const wt = revendication.worktreePath
  await Bun.write(`${wt}/fonctionnalite.txt`, 'travail commité mais pas fusionné\n')
  await Bun.$`git -C ${wt} add -A`.quiet()
  await Bun.$`git -C ${wt} commit -q -m "travail commité, non intégré à main"`.quiet()
  horodate('cas 3 · commit créé sur la branche dédiée, non intégré à main')

  const liberee = await cycle.liberer('equipe-commit')
  const worktreeIntact = await existe(wt)
  resultats.push({
    libelle: 'commit non intégré à la branche parente ⇒ worktree CONSERVÉ',
    ok: worktreeIntact && liberee.etat === 'terminee_non_liberee',
    detail: `worktree=${worktreeIntact} · état=${liberee.etat}`,
  })
}

// ---------------------------------------------------------------------------
// Cas 4 — dépôt rendu inaccessible : la vérification échoue ⇒ pire cas sûr.
// ---------------------------------------------------------------------------
{
  const revendication = await cycle.allouer({
    projet,
    idEquipe: 'equipe-cassee',
    epoch: 1,
    racineWorktrees: WORKTREES,
  })
  const wt = revendication.worktreePath
  // On casse le lien du worktree vers son dépôt : `git status` y lèvera.
  await Bun.$`rm -f ${wt}/.git`.quiet()
  horodate('cas 4 · lien .git du worktree supprimé — la vérification git va échouer')

  const liberee = await cycle.liberer('equipe-cassee')
  const worktreeIntact = await Bun.file(`${wt}/README.md`).exists()
  resultats.push({
    libelle: 'vérification git impossible ⇒ pire cas sûr, AUCUNE suppression',
    ok: worktreeIntact && liberee.etat === 'terminee_non_liberee',
    detail: `worktree=${worktreeIntact} · état=${liberee.etat}`,
  })
}

console.log('\n— Verdict du banc worktree (git réel) —')
let succes = true
for (const r of resultats) {
  if (!r.ok) succes = false
  console.log(`${r.ok ? '✓' : '✗'} ${r.libelle}\n    ${r.detail}`)
}

console.log(`\n· dépôt jetable conservé pour inspection : ${RACINE}`)
process.exit(succes ? 0 : 1)
