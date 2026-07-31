// ============ Menus contextuels — ce que chaque objet de l'app sait faire ============
//
// Un genre par type d'objet manipulable. Le moteur (`harness-menu-contextuel.js`)
// ne connaît aucune de ces actions : il lit `data-menu` et appelle la fabrique.
//
// ☠ Ces menus ne créent AUCUNE capacité nouvelle. Chaque entrée appelle une
// action qui existe déjà et qui a déjà été éprouvée par ailleurs — un menu qui
// serait le seul chemin vers une action deviendrait le seul chemin à tester, et
// les vues tactiles sans clic droit perdraient la fonction sans qu'on le voie.

/** Copie un texte, avec le même retour visuel partout. */
async function hCopier(texte, libelle = 'Copié') {
  try {
    await navigator.clipboard.writeText(texte);
    showToast(libelle, 'ok');
  } catch {
    showToast('Copie refusée par le navigateur', 'warn');
  }
}

// ---- Fil de l'orchestrateur ----
hMenuDeclarer('fil', (d) => [
  hMenuItem('Ouvrir', () => hOuvrirFil(d.id)),
  hMenuItem('Renommer…', async () => {
    const titre = await hInvite('Renommer le fil', d.titre || '');
    if (!titre) return;
    const r = await HarnessAPI.renameConversation(d.id, titre);
    if (r?.erreur) { showToast(`Renommage refusé — ${r.erreur}`, 'err'); return; }
    showToast('Fil renommé', 'ok');
    void hRafraichirFils();
  }),
  hMenuItem('Compacter le contexte', async () => {
    const r = await HarnessAPI.compactConversation(d.id);
    if (r?.erreur) { showToast(`Compaction refusée — ${r.erreur}`, 'err'); return; }
    showToast(r?.data?.compacted === false ? 'Rien à compacter' : 'Contexte compacté', 'ok');
  }),
  H_SEPARATEUR,
  hMenuItem('Copier l’identifiant', () => hCopier(d.id, 'Identifiant copié')),
  hMenuItem('Archiver le fil', async () => {
    const ok = await hConfirmer('Archiver ce fil ?', 'Il quitte la liste. La session et son historique restent sur le Pi.', 'Archiver');
    if (!ok) return;
    const r = await HarnessAPI.archiveConversation(d.id);
    if (r?.erreur) { showToast(`Archivage refusé — ${r.erreur}`, 'err'); return; }
    showToast('Fil archivé', 'ok');
    void hRafraichirFils();
  }, { danger: true }),
]);

/** Recharge la liste des fils après une action qui l'a modifiée. */
async function hRafraichirFils() {
  const r = await HarnessAPI.getConversations();
  if (r?.erreur) return;
  hOrch.list = r.data || [];
  const el = document.getElementById('hFilsListe');
  if (el) delete el.dataset.sig; // la signature bloquerait le rendu d'un titre changé
  hRenderFils();
}

// ---- Conversation de l'agent IA (stockée dans le navigateur) ----
hMenuDeclarer('chat', (d) => [
  hMenuItem('Ouvrir', () => resumeConversation(d.id)),
  hMenuItem('Renommer…', async () => {
    const liste = loadConversations();
    const conv = liste.find((c) => c.id === d.id);
    if (!conv) return;
    const titre = await hInvite('Renommer la conversation', conv.title || '');
    if (!titre) return;
    conv.title = titre;
    saveConversations(liste);
    if (state.currentConvId === d.id) state.convTitle = titre;
    renderConversationList();
    showToast('Conversation renommée', 'ok');
  }),
  H_SEPARATEUR,
  hMenuItem('Supprimer', async () => {
    const ok = await hConfirmer('Supprimer cette conversation ?', 'Elle n’est stockée que dans ce navigateur : la suppression est définitive.');
    if (!ok) return;
    deleteConversation(d.id);
    showToast('Conversation supprimée', 'ok');
  }, { danger: true }),
]);

// ---- Mission du parc ----
// ☠ Pause/reprise sont proposées selon l'état RÉEL de la mission : offrir
// « Reprendre » sur une mission qui tourne enverrait un ordre sans effet, et
// l'écran donnerait l'impression d'avoir agi.
hMenuDeclarer('mission', (d) => {
  const enPause = d.etat === 'paused';
  const terminale = ['terminee', 'echec'].includes(d.etat);
  return [
    hMenuItem('Ouvrir la mission', () => hOpenMission(d.id)),
    enPause
      ? hMenuItem('Reprendre l’équipe', () => hActionMission(d.id, 'resumeMission', 'Équipe reprise'), { desactive: terminale })
      : hMenuItem('Mettre l’équipe en pause', () => hActionMission(d.id, 'pauseMission', 'Équipe en pause'), { desactive: terminale }),
    H_SEPARATEUR,
    hMenuItem('Copier l’identifiant', () => hCopier(d.id, 'Identifiant copié')),
    hMenuItem('Arrêter l’équipe', async () => {
      const ok = await hConfirmer(
        'Arrêter cette équipe ?',
        `« ${d.titre || d.id} » — la session se ferme. Le travail déjà écrit sur disque reste intact, le contexte est perdu.`,
        'Arrêter',
      );
      if (ok) await hActionMission(d.id, 'terminateMission', 'Équipe arrêtée');
    }, { danger: true, desactive: terminale }),
  ];
});

async function hActionMission(id, methode, succes) {
  const r = await HarnessAPI[methode](id);
  if (r?.erreur) { showToast(`Refusé — ${r.erreur}`, 'err'); return; }
  showToast(succes, 'ok');
  void hRenderParc();
}

// ---- Notification ----
hMenuDeclarer('notif', (d) => [
  hMenuItem('Ouvrir le fil', () => hNotifOuvrir(d.notif, d.conv), { desactive: !d.conv }),
  hMenuItem('Marquer comme lue', async () => {
    await HarnessAPI.markNotificationRead(d.notif);
    hNotifDernierRendu = '';
    void hRenderNotifications();
  }),
  H_SEPARATEUR,
  hMenuItem('Tout marquer comme lu', async () => {
    await HarnessAPI.markAllNotificationsRead();
    hNotifDernierRendu = '';
    void hRenderNotifications();
  }),
]);

// ---- Session Claude Code ----
hMenuDeclarer('session', (d) => [
  hMenuItem('Ouvrir le terminal', () => openTerminal(d.name)),
  hMenuItem('Copier le nom', () => hCopier(d.name, 'Nom copié')),
  H_SEPARATEUR,
  hMenuItem('Terminer la session', async () => {
    const ok = await hConfirmer('Terminer cette session ?', `« ${d.name} » sera fermée. Le travail non enregistré du terminal est perdu.`, 'Terminer');
    if (ok) await killSession(d.name);
  }, { danger: true }),
]);

// ---- Message d'une conversation ou d'un fil de mission ----
hMenuDeclarer('parole', (d, noeud) => {
  const texte = (noeud.querySelector('.h-say') || noeud).innerText.trim();
  return [
    hMenuItem('Copier le message', () => hCopier(texte)),
    hMenuItem('Copier la sélection', () => hCopier(String(window.getSelection() || '').trim()), {
      desactive: String(window.getSelection() || '').trim() === '',
    }),
  ];
});
