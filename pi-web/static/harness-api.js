// ============================================================
// HarnessAPI — SEUL point d'accès aux données du harness
// ============================================================
// ☠ Aucune vue ne doit appeler fetch() directement pour le harness. Tout passe
// par ici. C'est le point unique à réécrire quand le back-end du harness
// existera (voir CONTRAT-API-HARNESS.md pour le contrat exact attendu).
//
// Aujourd'hui : renvoie des données de démonstration (HarnessMock), avec une
// latence simulée et un état "PC absent" activable depuis Paramètres, pour que
// le comportement dans le temps soit observable (H-65) sans qu'aucune ligne
// n'appelle jamais un serveur réel.

const HarnessAPI = (() => {
  const db = HarnessMock;
  let pcOnline = true; // ☠ démo uniquement — en réel, vient du lien Pi↔PC (server.py)
  let orchCtx = 23; // ☠ démo uniquement — en réel, getContextUsage() du SDK (mesuré, jamais estimé)

  function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
  function findAgent(missionId, agentId) {
    const m = findMission(missionId);
    return m ? (m.subagents || []).find((a) => a.id === agentId) || null : null;
  }

  return {
    /* ---- démo uniquement : jamais dans une build réelle ---- */
    _setPcOnline(v) { pcOnline = v; },
    _isPcOnline() { return pcOnline; },

    async getLinkStatus() {
      await delay(80);
      return pcOnline
        ? { up: true, lastSeq: 148203, lastHeartbeatAgo: '1,2 s' }
        : { up: false, lastSeq: 148203, lastHeartbeatAgo: null, downSince: '00:14' };
    },

    async getMissions() { return withPc(() => db.missions.map((m) => ({ ...m }))); },

    async getMission(id) { return withPc(() => findMission(id)); },

    async getAgent(missionId, agentId) { return withPc(() => findAgent(missionId, agentId)); },

    async getEscalades() { return withPc(() => db.escalades.map((e) => ({ ...e }))); },

    async getAccounts() { return withPc(() => JSON.parse(JSON.stringify(db.accounts))); },

    async getModels() {
      // ☠ En réel : `supportedModels()[].supportedEffortLevels`, jamais une constante figée.
      await delay(60);
      return db.models.map((m) => ({ ...m }));
    },

    async getOrchestratorGauges() {
      return withPc(() => ({
        contextPct: orchCtx,
        windowResetLabel: '17:00 · dans 2 h 12 · compte #1',
        costWindow: db.accounts[1].costWindow + db.accounts[2].costWindow,
      }));
    },

    async compactOrchestratorContext() {
      return withPc(() => { orchCtx = Math.max(4, Math.round(orchCtx * 0.28)); return { contextPct: orchCtx }; });
    },

    async sendOrchestratorMessage(text, options) {
      return withPc(() => ({
        reply: `Reçu (${options.model}${options.effort ? ' · ' + options.effort : ''}). Si ça implique de dispatcher une équipe, je te soumettrai le mandat pour autorisation — je ne lance jamais seul (H-61).`,
      }));
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

    async sendMissionInstruction(missionId, text) {
      return withPc(() => {
        const m = findMission(missionId);
        if (!m) return null;
        const ts = new Date().toTimeString().slice(0, 8);
        m.feed.push({ ts, type: 'instruction', tool: 'opérateur', text });
        m.feed.push({ ts, type: 'system', tool: 'accusé', text: "Reçue — mise en file, prise en compte au prochain tour de l'agent (H-67), ne l'interrompt pas." });
        return { queued: true };
      });
    },

    async pauseMission(id) {
      return withPc(() => {
        const m = findMission(id);
        if (!m) return null;
        m.state = 'paused'; m.pausedAgo = 'quelques secondes';
        m.feed.push({ ts: new Date().toTimeString().slice(0, 8), type: 'system', tool: 'pause', text: 'Mise en pause opérateur — session retenue, contexte préservé.' });
        return m;
      });
    },

    async resumeMission(id) {
      return withPc(() => {
        const m = findMission(id);
        if (!m) return null;
        m.state = 'running'; m.pausedAgo = null;
        m.feed.push({ ts: new Date().toTimeString().slice(0, 8), type: 'system', tool: 'reprise', text: 'Mission reprise par l\'opérateur — session vivante, contexte intact.' });
        return m;
      });
    },

    async terminateMission(id) {
      return withPc(() => {
        const m = findMission(id);
        if (!m) return null;
        m.state = 'terminee'; m.doneAgo = 'à l\'instant';
        m.feed.push({ ts: new Date().toTimeString().slice(0, 8), type: 'system', tool: 'fin', text: 'Mission terminée par l\'opérateur.' });
        return m;
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
    async emergencyStop() {
      return withPc(() => {
        let n = 0;
        db.missions.forEach((m) => { if (['running', 'requires_action', 'idle'].includes(m.state)) { m.state = 'paused'; n++; } });
        return { stopped: n };
      });
    },

    async resolveEscalade(escId, verdict, reason) {
      return withPc(() => {
        const idx = db.escalades.findIndex((e) => e.id === escId);
        if (idx === -1) return null;
        const [e] = db.escalades.splice(idx, 1);
        const m = findMission(e.missionId);
        if (m) {
          const pending = m.feed.find((f) => f.type === 'permission' && f.pending);
          if (pending) { pending.pending = false; pending.resolved = verdict === 'autorise' ? 'autorisée (opérateur)' : 'refusée (opérateur)'; }
          m.feed.push({ ts: new Date().toTimeString().slice(0, 8), type: 'system', tool: 'verdict',
            text: verdict === 'autorise' ? 'Verdict opérateur : autorisé — réinjecté via requestId, la mission reprend.' : `Verdict opérateur : refusé — motif réinjecté : "${reason}"` });
          if (!db.escalades.some((x) => x.missionId === m.id)) { m.state = 'running'; m.blockedSince = null; }
        }
        return { mission: m };
      });
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
