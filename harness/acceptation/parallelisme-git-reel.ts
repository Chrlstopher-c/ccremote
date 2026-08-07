/**
 * Banc d'essai RÉEL du parallélisme git (mandat E2 câblage-worktree + mandat E3
 * H-56 assoupli). Preuve MÉCANIQUE que la chaîne Pi→PC de `master` fait bien
 * ce que les deux mandats prétendent : deux équipes simultanées sur le MÊME
 * dépôt, chacune dans son propre `git worktree`, sans divergence silencieuse.
 *
 * `☠` Ce banc n'invente aucune double d'un composant : il appelle
 * `dispatcherMandat` (le VRAI point d'entrée de `master` quand H-61 autorise un
 * mandat) avec un `demarreur` dont la méthode `demarrer()` appelle elle-même
 * RÉELLEMENT `allouerWorktreeSiConfigure` — la fonction que `SuperviseurWorkers`
 * appelle en vrai côté PC. Rien n'est simulé entre « l'opérateur clique » et
 * « `git worktree add` s'exécute ».
 *
 * `☠` Le contrôle en sens inverse (g) est aussi important que les cas positifs :
 * un banc qui ne sait démontrer QUE le succès ne prouve rien sur la frontière —
 * H-56 strict doit rester en vigueur pour un projet non-git, sous peine de
 * régression silencieuse le jour où quelqu'un simplifie la garde.
 *
 * ☠ Aucun dépôt réel de Chris n'est touché : le banc crée ses propres dépôts
 * jetables et son propre registre SQLite jetable sous le scratchpad, et ne
 * supprime que ce qu'il a lui-même créé.
 * ☠ NE PAS transformer en `*.test.ts` : exécute de vraies commandes git.
 *
 * Usage : bun run acceptation/parallelisme-git-reel.ts
 */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pino from 'pino';

import {
  equipeLogger,
  GestionnaireCycleVieWorktree,
  GestionnaireWorktreeGitReel,
  InterrogateurGitReel,
} from '../projets/index.ts'
import { ouvrirRegistre, type Mission, type Proposition, type Registre } from '../control-plane/registre/index.ts'
import {
  dispatcherMandat,
  ErreurProjetOccupe,
  type DemarreurEquipe,
  type DependancesDispatch,
  type ResultatDispatch,
  type VerificationProjet,
} from '../control-plane/orchestrateur/dispatch-mandat.ts'
import { allouerWorktreeSiConfigure } from '../superviseur/worktree-wiring-workers.ts'
import { releverEtatGit } from '../superviseur/etat-git.ts'
import type { DemandeDemarrage, DemandeDemarrageTransportable } from '../superviseur/index.ts'
import { redigerFinEquipe } from '../control-plane/notifications/redaction.ts'

const RACINE = join(tmpdir(), `ccremote-parallelisme-${Date.now()}`)
const DEPOT = `${RACINE}/depot`
const NONGIT = `${RACINE}/non-git`
const WORKTREES = `${RACINE}/worktrees`
const REGISTRE_SQLITE = `${RACINE}/registre.sqlite`

function horodate(m: string): void {
  console.log(`[${new Date().toISOString()}] ${m}`)
}

/** Message d'erreur exploitable dans un `detail`, quelle que soit la forme levée. */
function texteErreur(erreur: unknown): string {
  return erreur instanceof Error ? `${erreur.name}: ${erreur.message}` : String(erreur)
}

interface Resultat {
  readonly libelle: string
  readonly ok: boolean
  readonly detail: string
}
const resultats: Resultat[] = []

/** Dépôt git jetable, avec un commit initial — même recette que worktree-git-reel.ts. */
async function creerDepotGitJetable(): Promise<void> {
  try {
    await Bun.$`mkdir -p ${DEPOT} ${WORKTREES}`.quiet()
    await Bun.$`git -C ${DEPOT} init -q -b main`.quiet()
    await Bun.$`git -C ${DEPOT} config user.email banc@local`.quiet()
    await Bun.$`git -C ${DEPOT} config user.name Banc`.quiet()
    await Bun.write(`${DEPOT}/README.md`, '# dépôt jetable du banc parallélisme\n')
    await Bun.$`git -C ${DEPOT} add -A`.quiet()
    await Bun.$`git -C ${DEPOT} commit -q -m "commit initial"`.quiet()
  } catch (erreur) {
    horodate(`✗ création du dépôt git jetable échouée : ${texteErreur(erreur)}`)
    throw erreur
  }
}

/** Dossier jetable délibérément NON git — sert le contrôle en sens inverse (g). */
async function creerDossierNonGitJetable(): Promise<void> {
  try {
    await Bun.$`mkdir -p ${NONGIT}`.quiet()
    await Bun.write(`${NONGIT}/notes.txt`, 'dossier volontairement non-git\n')
  } catch (erreur) {
    horodate(`✗ création du dossier non-git jetable échouée : ${texteErreur(erreur)}`)
    throw erreur
  }
}

/** Branche courante lue par une VRAIE commande git — jamais déduite de la mémoire. */
async function brancheCourante(chemin: string): Promise<string | null> {
  try {
    const sortie = await Bun.$`git -C ${chemin} branch --show-current`.quiet().text()
    const branche = sortie.trim()
    return branche === '' ? null : branche
  } catch (erreur) {
    horodate(`✗ lecture de branche échouée pour ${chemin} : ${texteErreur(erreur)}`)
    return null
  }
}

/** Écrit un fichier distinct puis le commite dans le worktree indiqué — travail réel, pas simulé. */
async function ecrireEtCommiter(worktree: string, fichier: string, message: string): Promise<void> {
  try {
    await Bun.write(`${worktree}/${fichier}`, `travail de ${fichier}\n`)
    await Bun.$`git -C ${worktree} add -A`.quiet()
    await Bun.$`git -C ${worktree} commit -q -m ${message}`.quiet()
  } catch (erreur) {
    horodate(`✗ écriture/commit échoués dans ${worktree} : ${texteErreur(erreur)}`)
    throw erreur
  }
}

/**
 * `DemarreurEquipe` RÉEL : reconstruit le `DemandeDemarrage` minimal que le PC
 * verrait (seuls `missionId`/`epoch`/`spec.cwd` sont lus par
 * `allouerWorktreeSiConfigure` — les autres champs de `WorkerSpec` n'ont aucun
 * consommateur sur ce chemin, mêmes valeurs neutres que
 * `worktree-wiring-workers.ts` pour `ConfigProjet`), puis appelle RÉELLEMENT
 * l'allocation git. C'est le point exact où la chaîne Pi→PC est exercée.
 */
function creerDemarreurReel(gestionnaireWorktrees: GestionnaireCycleVieWorktree): DemarreurEquipe {
  const log: pino.Logger = equipeLogger('banc-parallelisme')
  return {
    async demarrer(demande: DemandeDemarrageTransportable) {
      const demandePc: DemandeDemarrage = {
        missionId: demande.missionId,
        epoch: demande.epoch,
        promptInitial: demande.promptInitial,
        spec: {
          sessionId: demande.parametres.sessionId,
          cwd: demande.parametres.cwd,
          mandate: demande.parametres.mandate,
          deniedToolPatterns: demande.parametres.deniedToolPatterns,
          maxBudgetUsd: demande.parametres.maxBudgetUsd,
          mcpServers: {},
          portAuditPermissions: () => ({}),
        },
      }
      const revendication = await allouerWorktreeSiConfigure(
        { gestionnaireWorktrees, racineWorktrees: WORKTREES },
        demandePc,
        log,
      )
      if (revendication === null) {
        throw new Error('gestionnaire de worktrees non configuré — ne devrait jamais arriver dans ce banc')
      }
      return {
        detail: `worker démarré (banc) dans ${revendication.worktreePath}`,
        worktree: { chemin: revendication.worktreePath, branche: revendication.brancheDediee },
      }
    },
  }
}

/** Relevé git RÉEL du projet visé — jamais un booléen codé en dur. */
async function verifierProjetReel(chemin: string): Promise<VerificationProjet> {
  const constat = await releverEtatGit(chemin)
  return { present: true, estGit: constat.depot }
}

function construireProposition(projet: string): Proposition {
  const maintenant = Date.now()
  return {
    id: randomUUID(),
    conversationId: null,
    projet,
    objectif: 'preuve mécanique du parallélisme git (E2/E3)',
    critereArret: 'deux équipes actives simultanément, sans divergence',
    perimetre: projet,
    acces: 'ecriture',
    budgetMaxUsd: 5,
    modele: null,
    effort: null,
    statut: 'en_attente',
    missionId: null,
    detail: null,
    creeA: maintenant,
    majA: maintenant,
  }
}

// ---------------------------------------------------------------------------
// Préparation : dépôt git jetable, dossier non-git jetable, registre SQLite.
// ---------------------------------------------------------------------------
await creerDepotGitJetable()
await creerDossierNonGitJetable()
horodate(`dépôt git jetable prêt : ${DEPOT}`)
horodate(`dossier non-git jetable prêt : ${NONGIT}`)

const registre: Registre = ouvrirRegistre({ chemin: REGISTRE_SQLITE })
registre.comptes.enregistrer({ id: 'compte-banc', configDir: `${RACINE}/config-compte`, actif: true })
horodate('registre SQLite jetable ouvert, migrations appliquées, compte créé')

const gestionnaireWorktrees = new GestionnaireCycleVieWorktree({
  interrogateur: new InterrogateurGitReel(),
  gestionnaire: new GestionnaireWorktreeGitReel(),
})
const deps: DependancesDispatch = {
  registre,
  demarreur: creerDemarreurReel(gestionnaireWorktrees),
  verifierProjet: verifierProjetReel,
  repertoireProjets: RACINE,
}

// ---------------------------------------------------------------------------
// (a)+(b)+(c) — deux dispatchs RÉELS sur le même dépôt git.
// ---------------------------------------------------------------------------
const propositionGit = construireProposition(DEPOT)
let r1: ResultatDispatch | undefined
let r2: ResultatDispatch | undefined
try {
  r1 = await dispatcherMandat(propositionGit, deps)
  r2 = await dispatcherMandat(propositionGit, deps)
  resultats.push({
    libelle: '(a) deux dispatchs successifs sur le même dépôt git réussissent tous les deux',
    ok: true,
    detail: `mission1=${r1.missionId.slice(0, 8)} · mission2=${r2.missionId.slice(0, 8)}`,
  })
} catch (erreur) {
  resultats.push({
    libelle: '(a) deux dispatchs successifs sur le même dépôt git réussissent tous les deux',
    ok: false,
    detail: texteErreur(erreur),
  })
}

const activesSurDepot = registre.missions.listerActives().filter((m) => m.projet === DEPOT)
resultats.push({
  libelle: '(b) le registre contient DEUX missions actives simultanées sur ce projet',
  ok: activesSurDepot.length === 2,
  detail: `actives=${activesSurDepot.length} (attendu 2)`,
})
resultats.push({
  libelle: '(c) les deux missions portent projetEstGit === true',
  ok: activesSurDepot.length === 2 && activesSurDepot.every((m) => m.projetEstGit === true),
  detail: activesSurDepot.map((m) => `${m.id.slice(0, 8)}:${m.projetEstGit}`).join(' · '),
})

// ---------------------------------------------------------------------------
// (d)+(e)+(f) — worktrees distincts, branches distinctes, aucune divergence
// silencieuse entre les deux copies de travail.
// ---------------------------------------------------------------------------
let mission1: Mission | null = null
let mission2: Mission | null = null
if (r1 !== undefined && r2 !== undefined) {
  mission1 = registre.missions.exiger(r1.missionId)
  mission2 = registre.missions.exiger(r2.missionId)

  const wt1 = mission1.worktree
  const wt2 = mission2.worktree
  const existeReadme = async (c: string | null): Promise<boolean> =>
    c !== null && (await Bun.file(`${c}/README.md`).exists())
  const cree1 = await existeReadme(wt1)
  const cree2 = await existeReadme(wt2)
  resultats.push({
    libelle: '(d) worktrees créés, à des chemins DIFFÉRENTS, aucun n’étant le dépôt d’origine',
    ok: wt1 !== null && wt2 !== null && wt1 !== wt2 && wt1 !== DEPOT && wt2 !== DEPOT && cree1 && cree2,
    detail: `wt1=${wt1} · wt2=${wt2} · créés=${cree1}/${cree2}`,
  })

  const branche1 = wt1 === null ? null : await brancheCourante(wt1)
  const branche2 = wt2 === null ? null : await brancheCourante(wt2)
  resultats.push({
    libelle: '(e) les deux worktrees sont sur des branches git DIFFÉRENTES',
    ok: branche1 !== null && branche2 !== null && branche1 !== branche2,
    detail: `branche1=${branche1} · branche2=${branche2}`,
  })

  if (wt1 !== null && wt2 !== null) {
    await ecrireEtCommiter(wt1, 'travail-equipe-1.txt', 'travail équipe 1')
    await ecrireEtCommiter(wt2, 'travail-equipe-2.txt', 'travail équipe 2')
    const fuiteVers2 = await Bun.file(`${wt2}/travail-equipe-1.txt`).exists()
    const fuiteVers1 = await Bun.file(`${wt1}/travail-equipe-2.txt`).exists()
    const origineBranche = await brancheCourante(DEPOT)
    resultats.push({
      libelle: '(f) aucune divergence silencieuse : fichiers isolés, dépôt d’origine sur sa branche initiale',
      ok: !fuiteVers1 && !fuiteVers2 && origineBranche === 'main',
      detail: `fuite1→2=${fuiteVers2} · fuite2→1=${fuiteVers1} · brancheOrigine=${origineBranche}`,
    })
  } else {
    resultats.push({
      libelle: '(f) aucune divergence silencieuse : fichiers isolés, dépôt d’origine sur sa branche initiale',
      ok: false,
      detail: 'ignoré : au moins un worktree manquant après (d)',
    })
  }
} else {
  for (const libelle of [
    '(d) worktrees créés, à des chemins DIFFÉRENTS, aucun n’étant le dépôt d’origine',
    '(e) les deux worktrees sont sur des branches git DIFFÉRENTES',
    '(f) aucune divergence silencieuse : fichiers isolés, dépôt d’origine sur sa branche initiale',
  ]) {
    resultats.push({ libelle, ok: false, detail: 'ignoré : dispatch initial (a) en échec' })
  }
}

// ---------------------------------------------------------------------------
// (g) — contrôle en sens inverse : H-56 strict reste en vigueur hors git.
// ---------------------------------------------------------------------------
const propositionNonGit = construireProposition(NONGIT)
try {
  const premiere = await dispatcherMandat(propositionNonGit, deps)
  horodate(`(g) premier dispatch non-git accepté : mission ${premiere.missionId.slice(0, 8)}`)
  try {
    await dispatcherMandat(propositionNonGit, deps)
    resultats.push({
      libelle: '(g) H-56 strict : un second dispatch sur un dossier non-git DÉJÀ actif doit lever',
      ok: false,
      detail: 'aucune erreur levée — H-56 strict ne bloque plus les projets non-git',
    })
  } catch (erreur) {
    const nomOk = erreur instanceof Error && erreur.name === 'ErreurProjetOccupe'
    resultats.push({
      libelle: '(g) H-56 strict : un second dispatch sur un dossier non-git DÉJÀ actif doit lever',
      ok: nomOk && erreur instanceof ErreurProjetOccupe,
      detail: `erreur levée : ${texteErreur(erreur)}`,
    })
  }
} catch (erreur) {
  resultats.push({
    libelle: '(g) H-56 strict : un second dispatch sur un dossier non-git DÉJÀ actif doit lever',
    ok: false,
    detail: `ignoré : le premier dispatch non-git a échoué — ${texteErreur(erreur)}`,
  })
}

// ---------------------------------------------------------------------------
// (h) — la notification de fin d'équipe emprunte le bon texte sur une vraie
// mission git relue depuis le registre (pas un objet en mémoire construit à la main).
// ---------------------------------------------------------------------------
if (mission1 !== null) {
  const texte = redigerFinEquipe(mission1)
  const contientAttendu = texte.pourOrchestrateur.includes('plusieurs équipes en parallèle')
  const neContientPas = !texte.pourOrchestrateur.includes('OCCUPE ENCORE')
  resultats.push({
    libelle: '(h) notification de fin d’équipe : bon texte pour un projet git (H-56 assoupli)',
    ok: contientAttendu && neContientPas,
    detail:
      `contient « plusieurs équipes en parallèle »=${contientAttendu} · ` +
      `absence de « OCCUPE ENCORE »=${neContientPas}`,
  })
} else {
  resultats.push({
    libelle: '(h) notification de fin d’équipe : bon texte pour un projet git (H-56 assoupli)',
    ok: false,
    detail: 'ignoré : aucune mission1 disponible (dispatch initial en échec)',
  })
}

// ---------------------------------------------------------------------------
// Verdict, puis nettoyage — uniquement ce que ce banc a créé sous tmpdir.
// ---------------------------------------------------------------------------
console.log('\n— Verdict du banc parallélisme git (deux équipes réelles) —')
let succes = true
for (const r of resultats) {
  if (!r.ok) succes = false
  console.log(`${r.ok ? '✓' : '✗'} ${r.libelle}\n    ${r.detail}`)
}
console.log(`\n${resultats.filter((r) => r.ok).length}/${resultats.length} assertions passées`)

try {
  registre.fermer()
  rmSync(RACINE, { recursive: true, force: true })
  horodate(`nettoyage effectué : ${RACINE} supprimé`)
} catch (erreur) {
  horodate(`⚠ nettoyage incomplet de ${RACINE} : ${texteErreur(erreur)}`)
}

process.exit(succes ? 0 : 1)
