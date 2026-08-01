# Chantier — deux machines de travail simultanées (PC + VPS)

> **But de ce document** : contenir TOUT le contexte nécessaire à l'exécution, pour
> qu'une session neuve puisse attaquer sans rien connaître de la session du 01/08.
> Écrit après mesure sur le code et sur la production, jamais de mémoire.

---

## 1. Ce que Chris a demandé (01/08, verbatim résumé)

> « Faudrait pouvoir faire cohabiter la connexion pour deux machines de work, le VPS
> et mon PC, afin de départager les tâches. Par exemple les autres projets restent
> ici mais StockIOP c'est sur le VPS, et depuis l'app lorsque l'on crée une
> discussion faudrait choisir sur quelle machine le faire, avec un popup par exemple. »

### Décisions ARBITRÉES (Chris a dit « go », ne pas rouvrir sans raison)

| Question | Décision |
|---|---|
| Qui choisit la machine ? | **La conversation choisit, le projet vérifie.** La machine est portée par le fil ; au dispatch, le harness REFUSE si le projet n'existe pas sur la machine visée. |
| Changement en cours de route ? | **Non.** Machine fixée à la création du fil, non modifiable ensuite. Une équipe ne doit pas changer de machine au milieu d'un chantier. |
| H-56 (une équipe active par projet) | **Reste GLOBAL**, pas par machine. Sinon deux équipes travaillent sur deux clones du même dépôt et divergent en silence. |

---

## 2. État de la production au moment d'écrire

### Machines

| Rôle | Accès | Chemin du harness | Service |
|---|---|---|---|
| **Pi** (control plane, héberge) | `ssh -i ~/.ssh/id_ed25519_ccremote pi@pi.exemple` | `~/ccremote-harness` | `ccremote-harness` (system) |
| **VPS** (machine de travail, ACTIVE) | `ssh vps` / `ssh vps-root` (OVH vps.exemple) | `~/ccremote/harness` | `ccremote-pc` (`--user`, linger) |
| **PC** (machine de travail, DÉSACTIVÉE le 01/08) | local, user `trinity` | `/mnt/projects/ccremote/harness` | `ccremote-pc` (`--user`) — `inactive` + `disabled` |

`☠` **Le PC a été désactivé volontairement** (`systemctl --user disable ccremote-pc`)
parce que l'architecture actuelle ne supporte QU'UN superviseur. Ce chantier est
exactement ce qui permettra de le réactiver **en même temps** que le VPS.

### Lien Pi↔machine de travail

- Écoute : `0.0.0.0:8721` sur le Pi (`CCREMOTE_LIEN_HOST` / `CCREMOTE_LIEN_PORT` dans son `.env`).
- Exposé par Cloudflare Tunnel : **`wss://lien.exemple.com/`** → `localhost:8721`.
  Règle d'ingress posée par `deploy-harness-pi.sh` (idempotente).
- Le PC se connecte en LAN (`ws://pi.exemple:8721/`), le VPS en `wss://…` (il n'est pas sur le LAN).
- Auth : secret partagé en en-tête **`Authorization: Bearer`** (`composition/lien-pc-pi/secret.ts`),
  comparaison à temps constant, fermeture **4401** terminale. Vérifié en prod.
- Secret : `~/.ccremote-lien-secret` sur le PC. **NE JAMAIS LE RÉGÉNÉRER** — il doit être
  identique des deux côtés, sinon coupure silencieuse.

### Divers utile

- Registre du Pi : `~/ccremote-harness/registre.db`, **schéma v21**. Pas de `sqlite3` sur le Pi :
  utiliser `~/.bun/bin/bun` avec `bun:sqlite` via un script scp'é.
- Mot de passe UI : `<mot-de-passe-ui>` (variable `CCREMOTE_UI_PASSWORD`).
- Racine des projets : **`/mnt/projects`, EN DUR** (`superviseur-workers.ts` :
  `deps.racineProjets ?? '/mnt/projects'`). Sur le VPS c'est un **lien** vers `~/dev`
  (clones git de travail) — `~/prod` sert le trafic réel et ne doit jamais être touché.
- Projets présents : VPS → `stockiop` seulement. PC → tous les autres (`lumen`, `echohub`, `vela`, `agora`…).

---

## 3. Ce que le code fait AUJOURD'HUI (mesuré, avec emplacements)

### Le verrou, écrit noir sur blanc

`composition/pi/serveur-lien-pc.ts`, en-tête (~ligne 17) :

> `☠` **V1 — un seul PC** (H-56 : une mission active par projet ne change rien à ça,
> c'est structurel). Une nouvelle connexion authentifiée alors qu'une précédente est
> vivante est traitée comme un remplacement (supersede) : la plus récente gagne.

### Les points à modifier

| Fichier | Ligne (indicative) | Ce qu'il fait |
|---|---|---|
| `composition/pi/serveur-lien-pc.ts` | ~140 | `class FileConnexionUnique` — **un seul** emplacement |
| ” | ~167 | `accepter()` — évince l'actif inconditionnellement (`supersede`) |
| ” | ~220 | `fetch()` : `secretValide(extraireSecret(req), …)` → `srv.upgrade(req, { data: { authentifie } })` |
| ” | ~226 | `websocket.open()` : ferme en 4401 si `!ws.data.authentifie` |
| `composition/pi/assembler-control-plane.ts` | ~160 | `demarrerServeurLienPc({…})` |
| ” | ~167 | `const clientSuperviseurPc = new ClientSuperviseurPc(serveurLien.lien)` — **un seul** |
| ” | ~238 | `demarreur: clientSuperviseurPc` (injecté au dispatch) |
| ” | ~129 | `construireDependancesReconciliation(client)` |
| `composition/pi/client-superviseur-pc.ts` | 113 | `class ClientSuperviseurPc implements InventairePc, ReinitialisateurSession, ArreteurMission, RelanceurMission` |
| ” | 269 | `async demarrer(demande: DemandeDemarrageTransportable)` |
| `control-plane/orchestrateur/dispatch-mandat.ts` | ~581 | `await deps.demarreur.demarrer(demande)` — **le point de routage** |
| `composition/pc/bin-pc.ts` | 44 | `envObligatoire('CCREMOTE_LIEN_URL_PI')` — c'est là qu'ajouter l'identité |
| `superviseur/superviseur-workers.ts` | 136 | `this.#racineProjets = deps.racineProjets ?? '/mnt/projects'` |

### Dette n°6 — la tempête d'évictions (à corriger PAR ce chantier)

Deux process superviseurs simultanés se chassent en boucle : **1268 évictions**
observées au banc du 22/07. `supersede` n'a ni amortissement, ni identité de client.
`☠` Le symptôme (« des workers meurent sans raison ») **ne ressemble pas** à sa cause.

---

## 4. Plan — 5 briques, dans cet ordre

### Brique 1 — Identité du superviseur *(corrige la dette n°6)*

- Le client s'annonce : `CCREMOTE_MACHINE_ID` (défaut : `hostname()`), transmis en
  en-tête à l'upgrade — **jamais en paramètre d'URL** (même raison que le secret :
  les access logs de Cloudflare).
- `extraireMachineId(req)` à côté de `extraireSecret(req)` dans `composition/lien-pc-pi/secret.ts`.
- `FileConnexionUnique` → **une file par identité**. Le `supersede` ne joue plus
  qu'à identité **égale** : deux machines cohabitent, deux process d'une *même*
  machine s'évincent toujours (comportement voulu, c'est la reprise après crash).
- `☠` Identité absente ⇒ refuser la connexion (4401 ou un code dédié). Une identité
  par défaut partagée ferait cohabiter deux machines sous le même nom, et on
  retomberait sur la tempête sans le voir.

### Brique 2 — Registre de liens côté Pi *(la plus lourde)*

- `Map<machineId, { lien, client }>`, construite à la demande à la première
  connexion d'une machine.
- `assembler-control-plane.ts` : remplacer le client unique par un **registre**,
  et adapter les six consommateurs (dispatch, réconciliation, arrêt, relance,
  inventaire, télémétrie).
- Exposer `machinesConnectees()` pour l'API et l'UI.
- `☠` La réconciliation tourne aujourd'hui sur UN client. À N machines, elle doit
  tourner **par machine**, et ne jamais conclure « worker mort » pour une mission
  qui vit sur une machine actuellement hors ligne (H-75 : PC absent = nominal).

### Brique 3 — Migration (schéma v22)

```sql
ALTER TABLE conversation ADD COLUMN machine TEXT;   -- NULL = machine par défaut
ALTER TABLE mission      ADD COLUMN machine TEXT;   -- où l'équipe tourne RÉELLEMENT
```

`☠` `mission.machine` est indispensable : sans elle, impossible de savoir à quelle
machine adresser un arrêt, un suivi ou une relance. L'écrire **au dispatch**, à
partir de la machine réellement utilisée — jamais déduite après coup.

### Brique 4 — Routage au dispatch

- `dispatch-mandat.ts` : `deps.demarreur` → `deps.demarreurPour(machineId)`.
- Machine cible = `conversation.machine` (défaut : la seule connectée, ou refus si
  ambigu).
- **Vérifier que le projet existe sur la machine visée** (via `explorer_projets`)
  et refuser avec un message actionnable sinon — un modèle corrige à partir d'une
  liste, pas d'un échec muet (`code-standards.md`, « Model output is untrusted input »).
- Machine hors ligne ⇒ refus explicite, jamais une mission `planifiee` fantôme.

### Brique 5 — Interface

- Sélecteur de machine à la création d'un fil (le « popup »).
- Afficher la machine sur la carte de mandat et sur la carte d'équipe du Parc.
- Route API : liste des machines connectées.

---

## 5. Invariants à ne PAS casser

- **H-75** — une machine de travail absente est un ÉTAT nominal, jamais une erreur
  HTTP. Réponses : `{ pcOnline, stale, data }`.
- **H-56** — une équipe active par projet, **globalement** (contrainte `UNIQUE` sur
  `mission.projet` en base : un test qui crée deux missions sur le même projet
  échouera tant que la première n'est pas terminée).
- **H-61** — l'orchestrateur propose, l'humain autorise. Le choix de machine ne
  contourne pas l'autorisation.
- **Secret du lien** — jamais dans l'URL, jamais régénéré.
- **`/mnt/projects`** — même nom sur toutes les machines (les mandats portent des
  chemins absolus). Ne pas rendre configurable.
- **Le déploiement a plusieurs moitiés** : `deploy-harness-pi.sh` (Pi),
  `deploy-web-pi.sh` (UI), `deploy-superviseur-vps.sh` (VPS),
  `systemctl --user restart ccremote-pc` (PC). Un changement de protocole du lien
  impose de redéployer **toutes** les moitiés — sinon une moitié parle une
  version que l'autre ne comprend pas.

---

## 6. Outils de travail

### Banc de pilotage (conduire la prod depuis une session de code)

```bash
cd /mnt/projects/ccremote/harness
export CCREMOTE_UI_PASSWORD='<mot-de-passe-ui>'
bun pilotage/pilote.ts sante                 # harness + lien
bun pilotage/pilote.ts parc                  # équipes, états, coûts, modèles
bun pilotage/pilote.ts ouvrir "titre"        # nouveau fil → rend son id
bun pilotage/pilote.ts dire <convId> "…"     # envoie ET attend la fin du tour
bun pilotage/pilote.ts lire <convId> [n]
bun pilotage/pilote.ts mandats               # propositions en attente
bun pilotage/pilote.ts autoriser <propId>    # DÉPENSE — lance une équipe
```

### Déploiement

```bash
cd /mnt/projects/ccremote
CCREMOTE_LIEN_SECRET="$(cat ~/.ccremote-lien-secret)" ./deploy-harness-pi.sh
./deploy-web-pi.sh
CCREMOTE_LIEN_SECRET="$(cat ~/.ccremote-lien-secret)" ./deploy-superviseur-vps.sh [--demarrer]
./deploy-mcp-vps.sh
```

`☠` `deploy-superviseur-vps.sh --demarrer` **refuse** de démarrer si `ccremote-pc`
tourne sur le PC. **Ce garde-fou devra être levé à la fin de ce chantier** — c'est
précisément ce qu'il rend possible. Ne pas le retirer avant que la brique 1 soit
prouvée en réel.

### Vérifier / lire

```bash
# Journal du lien côté Pi
ssh -i ~/.ssh/id_ed25519_ccremote pi@pi.exemple \
  'sudo journalctl -u ccremote-harness --since "10 min ago" --no-pager | grep -iE "authentifi|supersede|refus"'

# Journal du superviseur VPS
ssh vps 'journalctl --user -u ccremote-pc --since "10 min ago" --no-pager | tail -20'

# Tests + typecheck (à la racine de harness/)
bun run tsc --noEmit && bun test          # référence au 01/08 : 1305 pass, 0 fail
```

---

## 7. Méthode — non négociable sur ce chantier

Ce chantier modifie un **chemin de contrôle**. La doctrine du dépôt s'applique en plein :

1. **Ne jamais re-concevoir un chemin de contrôle sur un récit.** Établir le fait
   sur un artefact réel (ligne de log, ligne en base, banc) AVANT la modification,
   et re-mesurer APRÈS.
2. **Valider chaque test dans les deux sens** : annuler le correctif, voir le test
   échouer, restaurer. Un test qui ne sait pas échouer décore.
3. **Quand le cas nominal et la contre-épreuve donnent le même résultat, le premier
   suspect est l'instrument.** (Payé le 01/08 : un banc a déclaré rouge une
   correction qui marchait, parce qu'il mesurait avant que le fait existe.)
4. **L'absence est silencieuse par défaut.** Trois défauts du 01/08 avaient la même
   forme : quelque chose n'existait pas, rien ne le disait, et le symptôme ne
   ressemblait pas à la cause. Toute nouvelle voie de transmission doit DIRE quand
   elle ne transporte rien.

### Motif maison à surveiller : « écrit, testé, branché sur rien »

Onze occurrences à ce jour. La dernière (01/08) : **aucune équipe n'avait jamais eu
un seul serveur MCP** depuis l'origine du harness, alors que son mandat lui
ordonnait d'utiliser Playwright. Cause : `settingSources` charge `settings.json`,
mais les MCP vivent dans `.claude.json` — un fichier que `CLAUDE_CONFIG_DIR`
remplace par celui du compte isolé, vide. **L'intention était juste, la voie de
transmission n'existait pas.** Vérifier systématiquement le point de CONSOMMATION.

---

## 8. Définition de fini

- [ ] PC et VPS connectés **en même temps**, visibles tous les deux côté Pi.
- [ ] Zéro supersede entre machines distinctes (journal du Pi à l'appui).
- [ ] Une conversation créée avec le choix de machine, persisté.
- [ ] Une équipe lancée sur le VPS travaille sur `stockiop` ; une équipe lancée sur
      le PC travaille sur un projet local — **les deux en même temps**.
- [ ] `arreter_equipe` / `suivre_equipe` atteignent la bonne machine.
- [ ] Un mandat visant un projet absent de la machine choisie est **refusé** avec un
      message actionnable.
- [ ] `systemctl --user enable --now ccremote-pc` réactivé sur le PC, et le garde-fou
      de `deploy-superviseur-vps.sh --demarrer` levé.
- [ ] Suite verte (référence : 1305 tests), typecheck propre.
- [ ] Documentation à jour : `TODO.md`, et dette n°6 marquée **fermée**.
