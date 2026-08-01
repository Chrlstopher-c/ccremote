// ============================================================
// DONNÉES DE DÉMONSTRATION — harness (orchestrateur + équipes)
// ============================================================
// ☠ Le back-end du harness n'existe pas encore (aucune API réelle à joindre).
// Tout ce fichier est une amorce fictive, mutable en mémoire, qui simule un
// comportement réel (délais, évolution dans le temps) pour rendre la maquette
// navigable — jamais une capacité vérifiée. Voir CONTRAT-API-HARNESS.md :
// c'est le contrat que le vrai harness devra honorer pour remplacer ce fichier.
//
// Seul harness-api.js lit ce module. Aucune vue n'y touche directement.

const HarnessMock = (() => {
  let nextId = 100;
  const uid = (prefix) => prefix + (nextId++);

  const models = [
    { id: 'claude-opus-4-8', label: 'Opus 4.8 (défaut)', effort: ['low', 'medium', 'high', 'xhigh', 'max'], enabled: true, fastMode: true, ultracode: true },
    { id: 'claude-sonnet-5', label: 'Sonnet 5', effort: ['low', 'medium', 'high', 'xhigh', 'max'], enabled: true, fastMode: false, ultracode: true },
    { id: 'claude-fable-5', label: 'Fable 5', effort: ['low', 'medium', 'high', 'xhigh', 'max'], enabled: true, fastMode: false, ultracode: true },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 — déconseillé', effort: [], enabled: false, fastMode: false, ultracode: false },
  ];
  // ☠ claude-opus-4-7 répond mais est ABSENT de supportedModels() (H-71.1, mesuré) :
  // volontairement retiré d'ici, pas grisé — rien à lui prêter honnêtement.
  // ☠ Haiku exclu du rôle d'orchestrateur (H-71) : aucun effort, aucune pensée adaptative.

  const accounts = {
    1: { id: 1, label: 'Compte #1', email: 'compte-a@exemple.fr', status: 'allowed', isUsingOverage: false,
      five_hour: { util: 38, resetLabel: '17:00 · dans 2 h 12' }, seven_day: { util: 54, resetLabel: '26/07 à 09:00' },
      costWindow: 3.40 },
    2: { id: 2, label: 'Compte #2', email: 'chris@echo-agency…', status: 'rejected', isUsingOverage: true,
      five_hour: { util: 100, resetLabel: '15:00 · dans 0 h 24' }, seven_day: { util: 38, resetLabel: '28/07 à 03:00' },
      costWindow: 9.85 },
  };
  let nextAccount = 1;

  const newInspection = (verdict, atLabel) => ({ lastVerdict: verdict || null, lastAt: atLabel || null });

  const missions = [
    {
      id: 'm1', title: 'Corriger la désynchronisation multi-dépôts', project: 'stockiop-ops',
      worktree: 'wt/fix-multidepot', branch: 'fix/multidepot-stock', account: 1, state: 'requires_action',
      ctx: 61, cost: 3.10, inspection: newInspection(null, null), team: 'lead + 2 sous-agents',
      model: 'claude-opus-4-8', epoch: 4, retries: '1 / 3', sessionId: 'ses_8f31c2…a04',
      mandate: { but: "Rétablir la cohérence de product_stock entre création produit, import CSV et transferts inter-dépôts.",
        critere: "Un transfert inter-dépôts réussit sur un produit créé par chacun des trois chemins, tests E2E passants." },
      blockedSince: '6 min', landing: null,
      subagents: [
        { id: 'a1', name: 'db-migration', role: 'sous-agent', status: 'actif',
          action: "Confirme que le chemin CSV n'écrit jamais product_stock — prépare le correctif de schéma.",
          feed: [
            { ts: '—', type: 'system', tool: 'invocation', text: "Invoqué par le lead pour tracer les écritures product_stock." },
            { ts: '—', type: 'activity', tool: '', text: "Confirmé : le chemin CSV n'écrit jamais product_stock." },
          ] },
        { id: 'a2', name: 'e2e-recette', role: 'sous-agent', status: 'attente',
          action: "En attente du correctif de schéma pour rejouer les tests E2E sur l'instance de recette.",
          feed: [{ ts: '—', type: 'system', tool: 'invocation', text: 'Invoqué par le lead, en attente.' }] },
      ],
      feed: [
        { ts: nowMinus(58), type: 'system', tool: 'session', text: 'Session démarrée · compte #1 · claude-opus-4-8' },
        { ts: nowMinus(52), type: 'permission', auto: true, tool: 'Read', text: 'Lecture de schema.sql — autorisée (auto)' },
        { ts: nowMinus(40), type: 'permission', auto: true, tool: 'Grep', text: 'Recherche des écritures product_stock — autorisée (auto)' },
        { ts: nowMinus(19), type: 'activity', tool: '', text: "Sous-agent db-migration : le chemin CSV n'écrit jamais product_stock, confirmé." },
      ],
    },
    {
      id: 'm3', title: 'Graphe canvas — tenir 60 fps à 2 000 nœuds', project: 'lattice',
      worktree: 'wt/graph-perf', branch: 'perf/graph-quadtree', account: 1, state: 'running',
      ctx: 48, cost: 4.40, inspection: newInspection('progres', 'il y a 9 min'), team: 'lead + 2 sous-agents',
      model: 'claude-opus-4-8', epoch: 2, retries: '0 / 3', sessionId: 'ses_a410f2…9c3', landing: null,
      mandate: { but: "Le graphe canvas doit tenir 60 fps avec 2 000 nœuds affichés, y compris pendant un drag.",
        critere: "Le sous-agent bench mesure ≥ 58 fps moyen sur 2 000 nœuds + drag continu de 10 s, culling quadtree actif." },
      subagents: [
        { id: 'a1', name: 'bench', role: 'sous-agent', status: 'actif',
          action: "Mesure 47 fps avant culling — relance le banc dès que le quadtree du lead est engagé.",
          feed: [{ ts: '—', type: 'activity', tool: '', text: '47 fps mesurés avant culling.' }] },
        { id: 'a2', name: 'renderer', role: 'sous-agent', status: 'actif',
          action: 'Implémente le culling quadtree dans src/graph/renderer.ts.',
          feed: [{ ts: '—', type: 'permission', auto: true, tool: 'Edit', text: 'Edit sur renderer.ts — autorisée (auto)' }] },
      ],
      feed: [
        { ts: nowMinus(30), type: 'system', tool: 'session', text: 'Session démarrée · compte #1 · claude-opus-4-8' },
        { ts: nowMinus(18), type: 'activity', tool: '', text: 'Sous-agent bench : 47 fps mesurés avant culling.' },
        { ts: nowMinus(3), type: 'activity', tool: '', text: "Lead : j'engage le culling quadtree." },
      ],
    },
    {
      id: 'm4', title: 'Scanner YARA incrémental sur inotify', project: 'aegis',
      worktree: 'wt/yara-inc', branch: 'feat/yara-incremental', account: 2, state: 'running',
      ctx: 88, cost: 7.20, inspection: newInspection('incertain', 'il y a 3 min'), team: 'lead + 2 sous-agents',
      model: 'claude-opus-4-8', epoch: 3, retries: '0 / 3', sessionId: 'ses_77e1b0…d22', landing: null,
      mandate: { but: "Ne rescanner que les fichiers modifiés (inotify) plutôt qu'un scan YARA complet à chaque cycle.",
        critere: "Un scan incrémental sur 200 fichiers modifiés dure < 2 s, contre 34 s pour un scan complet sur le même corpus." },
      // H-72.4 mesuré : le flux best-effort peut ne rien livrer pour un sous-agent connu.
      // On le montre quand même, sans détail, plutôt que de l'oublier.
      subagents: [
        { id: 'a1', name: 'watcher', role: 'sous-agent', status: 'actif',
          action: 'Watcher inotify stable — teste la couverture sur renommages en rafale.',
          feed: [{ ts: '—', type: 'activity', tool: '', text: 'Watcher stable sur créations/modifications.' }] },
        { id: 'a2', name: 'yara-scan', role: 'sous-agent', status: 'actif', feedUnavailable: true,
          action: 'Intègre le scan incrémental à partir des chemins remontés par le watcher.', feed: [] },
      ],
      feed: [
        { ts: nowMinus(90), type: 'system', tool: 'session', text: 'Session démarrée · compte #2 · claude-opus-4-8' },
        { ts: nowMinus(52), type: 'system', tool: 'compaction', text: 'Compaction #1 (PostCompact)' },
        { ts: nowMinus(4), type: 'activity', tool: '', text: 'Lead : watcher stable, je passe à l\'intégration.' },
      ],
    },
    {
      id: 'm5', title: 'Chiffrer la seed par PIN', project: 'nullnode', worktree: 'wt/seed-pin', account: 1,
      state: 'paused', ctx: 22, cost: 1.10, inspection: newInspection(null, null), team: 'lead seul',
      model: 'claude-opus-4-8', epoch: 1, retries: '0 / 3', sessionId: 'ses_c02e91…b45', pausedAgo: '3 h', landing: null,
      mandate: { but: "Chiffrer la seed NULLNODE au repos avec un PIN utilisateur (libsodium pwhash).",
        critere: "Une seed chiffrée ne se déchiffre qu'avec le bon PIN ; 5 essais faux déclenchent un throttle exponentiel." },
      subagents: [],
      feed: [
        { ts: nowMinus(200), type: 'system', tool: 'session', text: 'Session démarrée · compte #1 · claude-opus-4-8' },
        { ts: nowMinus(180), type: 'system', tool: 'pause', text: 'Mise en pause opérateur — session retenue, contexte préservé.' },
      ],
    },
    {
      id: 'm7', title: 'Réécrire le writer RPF en Rust', project: 'gtav-mods', worktree: 'wt/rpf-writer', account: 2,
      state: 'echec', ctx: 100, cost: 46.20, inspection: newInspection('boucle', 'il y a 1 h'), team: 'lead + 1 sous-agent',
      model: 'claude-opus-4-8', epoch: 5, retries: '3 / 3', landing: null, subagents: [],
      mandate: { but: "Réécrire le writer RPF v7 en Rust pour remplacer l'outil C# actuel.",
        critere: "Un fichier .rpf généré par l'outil Rust est byte-identique à celui produit par l'outil C# de référence." },
      feed: [
        { ts: nowMinus(300), type: 'system', tool: 'retry', text: 'Relance 2/3 — error_max_turns' },
        { ts: nowMinus(60), type: 'system', tool: 'inspection', text: 'Inspection à 30 $ — verdict incertain, ne coupe pas' },
        { ts: nowMinus(5), type: 'system', tool: 'inspection', text: 'Inspection à 50 $ — verdict boucle : mission arrêtée par le juge, worktree conservé.' },
      ],
    },
  ];

  function nowMinus(sec) {
    const d = new Date(Date.now() - sec * 1000);
    return d.toTimeString().slice(0, 8);
  }


  return { uid, models, accounts, missions, get nextAccount() { return nextAccount; },
    set nextAccount(v) { nextAccount = v; }, newInspection };
})();
