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
//   RÉEL   — getMissions, getMission, getEscalades, getAccounts, getLinkStatus
//            servis par le control plane (Bun) via /api/harness/*, relayé par
//            pi-web qui porte l'authentification.
//   RÉEL   — écritures : resolveEscalade, terminateMission, pauseMission,
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
  let orchCtx = 23; // ☠ démo uniquement — en réel, getContextUsage() du SDK (mesuré, jamais estimé)

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

    async getEscalades() { return lireReel('/escalades'); },

    async getAccounts() { return lireReel('/accounts'); },

    /* ---- Conversations orchestrateur (multi-fils, streaming) — RÉEL ---- */
    // ☠ La persistance vit côté serveur : un rechargement dur relit le fil ici,
    // rien n'est perdu. Le streaming = sondage de /events?since=curseur.
    async getConversations() { return lireReel('/orchestrator/conversations'); },
    async getConversation(id) { return lireReel(`/orchestrator/conversations/${encodeURIComponent(id)}`); },
    async getConversationEvents(id, since) {
      return lireReel(`/orchestrator/conversations/${encodeURIComponent(id)}/events?since=${since | 0}`);
    },
    async createConversation(titre) { return ecrireReel('/orchestrator/conversations', titre ? { titre } : {}); },
    async sendConversationMessage(id, text, choix) {
      // ☠ NON bloquant : le serveur enfile puis rend la main, la réponse arrive
      // en streaming via getConversationEvents. On ne fabrique jamais de réponse.
      // ☠ `model`/`effort` n'étaient PAS transmis sur cette route : le sélecteur
      // de l'interface ne pilotait donc rien du tout, la session tournait sur sa
      // constante. Corrigé le 23/07 — et appliqué réellement côté serveur.
      return ecrireReel(`/orchestrator/conversations/${encodeURIComponent(id)}/message`, {
        text,
        model: choix?.model,
        effort: choix?.effort,
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

    async compactOrchestratorContext() {
      return withPc(() => { orchCtx = Math.max(4, Math.round(orchCtx * 0.28)); return { contextPct: orchCtx }; });
    },

    // ☠ RÉEL : le message part vers la session orchestrateur sur le Pi et
    // attend SA réponse. Un échec (501 session inactive, timeout) renvoie
    // { erreur } — jamais une réponse fabriquée comme le faisait la démo.
    async sendOrchestratorMessage(text, options) {
      const r = await ecrireReel('/orchestrator/message', { text, model: options?.model, effort: options?.effort });
      if (!r.ok) return { erreur: r.erreur };
      return { reply: r.reply ?? r.effet };
    },

    async proposeMandate(fields) {
      return withPc(() => {
        const p = { id: db.uid('prop'), ...fields, status: 'pending' };
        db.proposals.push(p);
        return p; // effet: 'differe' — aucune équipe créée ici (H-61)
      });
    },

    async approveProposal(id) {
      return withPc(() => {
        const p = db.proposals.find((x) => x.id === id);
        if (!p || p.status !== 'pending') return null;
        p.status = 'approved';
        const account = db.accounts[db.nextAccount].status === 'allowed' ? db.nextAccount : (db.nextAccount === 1 ? 2 : 1);
        const missionId = db.uid('m');
        const mission = {
          id: missionId, title: p.but.length > 60 ? p.but.slice(0, 60) + '…' : p.but, project: p.projet,
          worktree: 'wt/' + missionId, branch: 'auto/' + missionId, account, state: 'running', ctx: 2, cost: 0,
          inspection: db.newInspection(null, null), team: 'lead — équipe en constitution', model: 'claude-opus-4-8',
          epoch: 1, retries: '0 / 3', sessionId: 'ses_' + missionId + '…new', freshlyDispatched: true, subagents: [],
          landing: null, mandate: { but: p.but, critere: p.critere },
          feed: [{ ts: new Date().toTimeString().slice(0, 8), type: 'system', tool: 'dispatch',
            text: `Mission autorisée par l'opérateur — équipe en cours de constitution sur compte #${account}.` }],
        };
        db.missions.push(mission);
        return mission;
      });
    },

    async rejectProposal(id) {
      return withPc(() => {
        const p = db.proposals.find((x) => x.id === id);
        if (p && p.status === 'pending') p.status = 'refused';
        return p || null;
      });
    },




    async runInspection(id) {
      return withPc(() => {
        const m = findMission(id);
        if (!m || ['echec', 'terminee'].includes(m.state)) return null;
        const verdict = m.ctx >= 80
          ? (Math.random() < 0.45 ? 'boucle' : (Math.random() < 0.5 ? 'incertain' : 'progres'))
          : (Math.random() < 0.82 ? 'progres' : 'incertain');
        m.inspection = db.newInspection(verdict, 'à l\'instant');
        if (verdict === 'boucle') m.state = 'echec';
        m.feed.push({ ts: new Date().toTimeString().slice(0, 8), type: 'system', tool: 'inspection',
          text: `Inspection à ${m.cost.toFixed(2)} $ — verdict ${verdict}.` });
        return m;
      });
    },

    /* ---- H-57 : deux commandes séparées, jamais confondues ---- */
    async pauseGlobal() {
      return withPc(() => {
        db.missions.forEach((m) => { if (['running', 'requires_action'].includes(m.state)) m._pausedByGlobal = m.state; });
        return { paused: true };
      });
    },
    async resumeGlobal() { return withPc(() => ({ paused: false })); },

    /* ---- ÉCRITURES RÉELLES ---- */

    // ☠ Le motif d'un refus est RÉINJECTÉ à l'agent via son requestId — c'est ce
    // qui lui permet de repartir sur une autre voie. Le serveur refuse un
    // « refuse » sans motif ; on ne contourne pas ici.
    async resolveEscalade(escId, verdict, reason) {
      const r = await ecrireReel(`/escalades/${encodeURIComponent(escId)}/resolve`, { verdict, reason });
      if (!r.ok) return { erreur: r.erreur };
      // Retrait local de la file : le serveur fait autorité, on reflète.
      const idx = db.escalades.findIndex((e) => e.id === escId);
      if (idx !== -1) db.escalades.splice(idx, 1);
      return { ok: true };
    },

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
