// ============================================================
// HarnessAPI — SEUL point d'accès aux données du harness
// ============================================================
// ☠ Aucune vue ne doit appeler fetch() directement pour le harness. Tout passe
// par ici. C'est le point unique à réécrire quand le back-end du harness
// existera (voir CONTRAT-API-HARNESS.md pour le contrat exact attendu).
//
// État au 22/07/2026 — LA MOITIÉ EST RÉELLE, l'autre est encore de la démo.
// Ce mélange est explicite et lisible plus bas (LECTURES_REELLES) : un
// basculement silencieux ferait croire à des données vraies là où il n'y en a
// pas, ce qui est la pire des deux situations.
//
//   RÉEL   — getMissions, getMission, getAccounts, getLinkStatus
//            servis par le control plane (Bun) via /api/harness/*, relayé par
//            pi-web qui porte l'authentification.
//   RÉEL   — écritures : terminateMission, pauseMission,
//            resumeMission, sendMissionInstruction, emergencyStop. Elles
//            traversent le lien vers le PC. Un échec renvoie { erreur } et DOIT
//            être affiché : un ordre non transmis cru transmis est le pire cas.
//   DÉMO   — orchestrateur (conversation, mandats, jauges) et simulateurs. La
//            session maître n'est pas encore déployée sur le Pi.
//
// `☠` Les champs `subagents`, `feed`, `inspection` et `landing` reviennent
// VIDES du serveur réel : ils vivent sur le PC et ne sont pas encore remontés.
// Les vues doivent les traiter comme absents, jamais compter dessus.

const HarnessAPI = (() => {
  const db = HarnessMock;
  let pcOnline = true; // ☠ démo uniquement — le réel vient du lien Pi↔PC

  function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ---- Accès réel au control plane -------------------------------------
  // ☠ Trois issues distinctes, jamais confondues (H-75) :
  //   { pcOnline: true  } données fraîches
  //   { pcOnline: false } PC éteint — normal, surtout la nuit
  //   { erreur: '…' }     le control plane lui-même ne répond pas — une panne
  // Écraser la troisième en deuxième ferait chercher un problème sur le PC
  // pendant que le serveur est mort sur le Pi.
  async function lireReel(chemin) {
    try {
      const rep = await fetch(`/api/harness${chemin}`, { headers: { accept: 'application/json' } });
      const corps = await rep.json();
      if (!rep.ok) {
        return { pcOnline: false, stale: true, data: null, erreur: corps.message || corps.error || `HTTP ${rep.status}` };
      }
      return corps;
    } catch (e) {
      return { pcOnline: false, stale: true, data: null, erreur: `Contact impossible avec le Pi : ${e.message}` };
    }
  }

  // ☠ Écriture réelle. Contrairement à une lecture, un échec ici doit être VU :
  // l'opérateur croirait sinon sa mission arrêtée ou son agent débloqué. On ne
  // renvoie jamais un succès par défaut.
  async function ecrireReel(chemin, corps) {
    try {
      const rep = await fetch(`/api/harness${chemin}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corps || {}),
      });
      const data = await rep.json();
      if (!rep.ok) return { ok: false, erreur: data.message || data.error || `HTTP ${rep.status}` };
      // Laisse passer tout le corps (effet, reply, conversation…) — certaines
      // écritures renvoient plus qu'un simple accusé.
      return { ok: true, ...data };
    } catch (e) {
      return { ok: false, erreur: `Ordre non transmis : ${e.message}` };
    }
  }

  function pcAbsentPayload() {
    // H-75 : une absence de PC est un état normal à afficher, jamais une erreur.
    return { pcOnline: false, stale: true, message: "PC absent — dernières données connues, pas d'erreur." };
  }

  async function withPc(fn) {
    await delay(120 + Math.random() * 180);
    if (!pcOnline) return { ...pcAbsentPayload(), data: null };
    return { pcOnline: true, stale: false, data: fn() };
  }

  function findMission(id) { return db.missions.find((m) => m.id === id) || null; }
  return {
    /* ---- démo uniquement : jamais dans une build réelle ---- */
    _setPcOnline(v) { pcOnline = v; },
    _isPcOnline() { return pcOnline; },

    /* ================= LECTURES RÉELLES (control plane) ================= */

    async getLinkStatus() {
      const rep = await lireReel('/health');
      if (rep.erreur) return { up: false, erreur: rep.erreur };
      // `up` = le lien vers le PC, pas la santé du serveur : les deux sont
      // distincts et l'interface doit pouvoir dire lequel manque.
      return { up: rep.pcOnline === true || rep.ok === true ? !!rep.pcOnline : false };
    },

    async getMissions() { return lireReel('/missions'); },

    async getMission(id) { return lireReel(`/missions/${encodeURIComponent(id)}`); },


    async getAccounts() { return lireReel('/accounts'); },

    /* ---- Conversations orchestrateur (multi-fils, streaming) — RÉEL ---- */
    // ☠ La persistance vit côté serveur : un rechargement dur relit le fil ici,
    // rien n'est perdu. Le streaming = sondage de /events?since=curseur.
    async getConversations() { return lireReel('/orchestrator/conversations'); },
    async getConversation(id) { return lireReel(`/orchestrator/conversations/${encodeURIComponent(id)}`); },
    async getConversationEvents(id, since) {
      return lireReel(`/orchestrator/conversations/${encodeURIComponent(id)}/events?since=${since | 0}`);
    },
    async createConversation(titre, machine) {
      // ☠ `machine` n'est envoyée que si elle a été RÉELLEMENT choisie : une
      // chaîne vide serait refusée par le serveur, qui valide contre les
      // machines connues. Absente ⇒ le routage tranche seul, sans ambiguïté.
      const corps = {};
      if (titre) corps.titre = titre;
      if (machine) corps.machine = machine;
      return ecrireReel('/orchestrator/conversations', corps);
    },

    /** Machines de travail connues du Pi, en ligne ou non (migration 22). */
    async getMachines() { return lireReel('/machines'); },

    /**
     * Rattache un fil EXISTANT à une machine.
     * ☠ Seul moyen de récupérer un fil ouvert quand une seule machine était en
     * ligne : sans machine écrite, il tombe en « aucune machine précisée et
     * plusieurs sont en ligne » dès que la seconde démarre. Le serveur refuse le
     * déplacement d'un fil qui porte encore une équipe vivante.
     */
    async setConversationMachine(id, machine) {
      return ecrireReel(`/orchestrator/conversations/${encodeURIComponent(id)}/machine`, { machine });
    },

    /**
     * Relevé matériel PAR MACHINE, sur le lien du harness.
     * ☠ Route séparée de `/machines` à dessein : celle-ci fait un aller-retour
     * par machine (jusqu'à Cloudflare pour le VPS), alors que `/machines` sert
     * le sélecteur de fil et doit rester instantané.
     */
    async getMachineMetrics() { return lireReel('/machines/metriques'); },
    async sendConversationMessage(id, text, choix, pieces) {
      // ☠ NON bloquant : le serveur enfile puis rend la main, la réponse arrive
      // en streaming via getConversationEvents. On ne fabrique jamais de réponse.
      // ☠ `model`/`effort` n'étaient PAS transmis sur cette route : le sélecteur
      // de l'interface ne pilotait donc rien du tout, la session tournait sur sa
      // constante. Corrigé le 23/07 — et appliqué réellement côté serveur.
      return ecrireReel(`/orchestrator/conversations/${encodeURIComponent(id)}/message`, {
        text,
        model: choix?.model,
        effort: choix?.effort,
        // ☠ MÊME PANNE que `model`/`effort` avant le 23/07, découverte le 07/08 :
        // la case « mode rapide » existait à l'écran, gérait son état et se
        // grisait sur les modèles qui ne le déclarent pas — et n'était transmise
        // NULLE PART. Câblée bout en bout (migration 28, `applyFlagSettings`).
        fastMode: choix?.fastMode,
        // ☠ Absentes plutôt que `[]` : le corps d'un message sans capture ne
        // grossit pas d'un champ vide, et la route distingue les deux cas.
        ...(pieces !== undefined && pieces.length > 0 ? { pieces } : {}),
      });
    },
    async renameConversation(id, titre) {
      return ecrireReel(`/orchestrator/conversations/${encodeURIComponent(id)}/rename`, { titre });
    },
    // ☠ La compaction est faite PAR LE HARNESS (aucune API SDK ne l'expose) :
    // résumé du fil, puis session neuve amorcée dessus. `compacted:false` n'est
    // pas une erreur — c'est « il n'y avait rien à compacter ».
    async compactConversation(id) {
      return ecrireReel(`/orchestrator/conversations/${encodeURIComponent(id)}/compact`, {});
    },

    // ☠ RÉEL depuis le 01/08 — le canal asynchrone (migration 14). Rend aussi
    // le compteur de non-lues : le badge ne doit PAS se déduire de la longueur
    // de la liste, qui est plafonnée côté serveur et mentirait au-delà.
    async getNotifications() {
      const r = await lireReel('/notifications');
      if (r.erreur) return { notifications: [], unread: 0, erreur: r.erreur };
      const d = r.data || {};
      return { notifications: Array.isArray(d.notifications) ? d.notifications : [], unread: d.unread || 0 };
    },
    async markNotificationRead(id) {
      return ecrireReel(`/notifications/${encodeURIComponent(id)}/read`, {});
    },
    async markAllNotificationsRead() { return ecrireReel('/notifications/read-all', {}); },

    // Rappels d'un fil (migration 16) — RÉEL. La création et la rédaction des
    // consignes appartiennent à l'orchestrateur : l'écran voit et contrôle.
    async getRappels(conversationId) {
      const r = await lireReel(`/orchestrator/conversations/${encodeURIComponent(conversationId)}/rappels`);
      if (r.erreur) return { rappels: [], erreur: r.erreur };
      return { rappels: Array.isArray(r.data) ? r.data : [] };
    },
    async actionRappel(conversationId, rappelId, action) {
      return ecrireReel(
        `/orchestrator/conversations/${encodeURIComponent(conversationId)}/rappels/${encodeURIComponent(rappelId)}/${action}`,
        {},
      );
    },

    // Fenêtre d'autonomie d'un fil (migration 15). `start`/`end` à null = retrait.
    async setAutonomie(conversationId, start, end, goal) {
      return ecrireReel(`/orchestrator/conversations/${encodeURIComponent(conversationId)}/autonomie`, { start, end, goal });
    },

    // H-61 : mandats en attente d'autorisation humaine — RÉEL.
    async getPropositions() { return lireReel('/orchestrator/propositions'); },
    async approveMandat(id) { return ecrireReel(`/orchestrator/propositions/${encodeURIComponent(id)}/approve`, {}); },
    async rejectMandat(id) { return ecrireReel(`/orchestrator/propositions/${encodeURIComponent(id)}/reject`, {}); },

    async archiveConversation(id) {
      return ecrireReel(`/orchestrator/conversations/${encodeURIComponent(id)}/archive`, {});
    },

    // ☠ RÉEL depuis le 23/07. Interrogeait le jeu de DÉMO (`findAgent` sur `db`) :
    // cliquer sur un sous-agent réel rendait « Sous-agent introuvable », alors que
    // la vue Mission l'affichait juste au-dessus.
    async getAgent(missionId, agentId) {
      return lireReel(`/missions/${encodeURIComponent(missionId)}/agents/${encodeURIComponent(agentId)}`);
    },

    // ☠ RÉEL depuis le 31/07. Cette route lisait la MAQUETTE : le sélecteur
    // proposait des modèles et des niveaux d'effort sans rapport avec ce que le
    // CLI accepte. Les niveaux viennent maintenant du catalogue serveur, lui-même
    // aligné sur `supportedModels()` — Haiku n'en déclare AUCUN, et un niveau
    // invalide est ignoré EN SILENCE par le SDK, jamais rejeté.
    async getModels() {
      const r = await lireReel('/modeles');
      // Repli sur la maquette seulement si le Pi est injoignable : un sélecteur
      // vide empêcherait tout choix, y compris le modèle déjà en place.
      if (r.erreur || !Array.isArray(r.data)) return db.models.map((m) => ({ ...m }));
      return r.data;
    },

    /* ================= ENCORE EN DÉMO ==================================== */

    // ☠ RÉEL : le contexte vient de la sentinelle de la session orchestrateur.
    // contextPct null = session inactive ou pas encore de mesure — l'UI doit
    // afficher « — », jamais un pourcentage inventé.
    async getOrchestratorGauges() {
      const r = await lireReel('/orchestrator/gauges');
      if (r.erreur) return { contextPct: null, active: false, erreur: r.erreur };
      const d = r.data || {};
      return { contextPct: d.contextPct ?? null, active: !!d.active, windowResetLabel: null, costWindow: null };
    },

    // ☠ RÉEL : le message part vers la session orchestrateur sur le Pi et
    // attend SA réponse. Un échec (501 session inactive, timeout) renvoie
    // { erreur } — jamais une réponse fabriquée comme le faisait la démo.
    async sendOrchestratorMessage(text, options) {
      const r = await ecrireReel('/orchestrator/message', { text, model: options?.model, effort: options?.effort });
      if (!r.ok) return { erreur: r.erreur };
      return { reply: r.reply ?? r.effet };
    },

    /* ☠ `proposeMandate` / `approveProposal` / `rejectProposal` SUPPRIMÉES le
       01/08 avec le formulaire de mandat manuel : elles écrivaient dans la base
       de démonstration, aucune route serveur n'existait. Le seul chemin réel de
       création d'équipe passe par l'orchestrateur (H-61 : il propose, l'humain
       autorise) — voir `approveMandat` / `rejectMandat`, qui sont réels. */

    /**
     * ☠ Était une MAQUETTE : elle tapait dans `harness-mock-data.js` et tirait
     * son verdict avec `Math.random()`. Sur une vraie mission, `findMission`
     * rendait `undefined` et il ne se passait rigoureusement rien — un bouton
     * qui n'a jamais rien inspecté, sans qu'aucune erreur ne le signale.
     */
    async runInspection(id) {
      return ecrireReel(`/missions/${encodeURIComponent(id)}/inspect`, {});
    },

    /** Tranche un verdict de boucle : `confirme` arrête l'équipe, `decline` la laisse tourner. */
    async decideInspection(id, decision) {
      return ecrireReel(`/missions/${encodeURIComponent(id)}/inspect/decision`, { decision });
    },

    /* ☠ `pauseGlobal` / `resumeGlobal` SUPPRIMÉES le 01/08. Elles n'ont jamais
       rien mis en pause : aucune route serveur n'existait, la fonction marquait
       un champ sur la base de démonstration. Seul l'arrêt d'urgence est réel.
       La pause par MISSION (`pauseMission`), elle, l'a toujours été. */

    /* ---- ÉCRITURES RÉELLES ---- */

    async terminateMission(id) {
      const r = await ecrireReel(`/missions/${encodeURIComponent(id)}/terminate`, {});
      return r.ok ? { ok: true } : { erreur: r.erreur };
    },

    // ☠ `effet` dit si l'instruction a été RETENUE (mission en pause) plutôt que
    // transmise. L'afficher n'est pas cosmétique : sinon l'opérateur attend une
    // réaction de l'agent qui ne viendra qu'à la reprise.
    async sendMissionInstruction(missionId, text) {
      const r = await ecrireReel(`/missions/${encodeURIComponent(missionId)}/instruction`, { text });
      return r.ok ? { ok: true, effet: r.effet } : { erreur: r.erreur };
    },

    async pauseMission(id) {
      const r = await ecrireReel(`/missions/${encodeURIComponent(id)}/pause`, {});
      return r.ok ? { ok: true, effet: r.effet } : { erreur: r.erreur };
    },

    async resumeMission(id) {
      const r = await ecrireReel(`/missions/${encodeURIComponent(id)}/resume`, {});
      return r.ok ? { ok: true, effet: r.effet } : { erreur: r.erreur };
    },

    async emergencyStop() {
      const r = await ecrireReel('/safety/emergency-stop', {});
      return r.ok ? { ok: true } : { erreur: r.erreur };
    },

    /* ---- démo uniquement : simulateurs pour rendre la maquette navigable (H-65) ---- */
    async simulateSaturation(accId) {
      return withPc(() => {
        const a = db.accounts[accId];
        a.status = 'rejected'; a.isUsingOverage = true;
        if (a.five_hour) a.five_hour.util = 100;
        db.nextAccount = accId === 1 ? 2 : 1;
        return { account: a, nextAccount: db.nextAccount };
      });
    },
    async simulateReset(accId) {
      return withPc(() => {
        const a = db.accounts[accId];
        a.status = 'allowed'; a.isUsingOverage = false;
        if (a.five_hour) a.five_hour.util = 12;
        return { account: a };
      });
    },
    async simulateLanding(missionId) {
      return withPc(() => {
        const m = findMission(missionId);
        if (!m || (m.landing && m.landing.active)) return null;
        const acc = db.accounts[m.account];
        m.landing = { active: true, sinceLabel: 'à l\'instant', account: m.account, resetLabel: acc.five_hour.resetLabel, step: 0 };
        return m;
      });
    },
  };
})();
