// ============ HARNESS — vue sous-agent (H-72.2 / H-72.3 / H-72.4) ============
// Même niveau de détail que le lead. Observateur externe en lecture seule
// (H-72.1) : ce flux ne transite jamais par le contexte d'un autre agent.

function hOpenAgent(missionId, agentId) {
  HarnessState.selectedMissionId = missionId;
  HarnessState.selectedAgentId = agentId;
  hGoto('harness-agent');
  hRenderAgentDetail(missionId, agentId);
}
function hBackFromAgent() {
  const mid = HarnessState.selectedMissionId;
  hGoto('harness-mission');
  if (mid) hRenderMissionDetail(mid);
}

async function hRenderAgentDetail(missionId, agentId) {
  const res = await HarnessAPI.getAgent(missionId, agentId);
  const a = res.data;
  const mRes = await HarnessAPI.getMission(missionId);
  const m = mRes.data;
  if (!a || !m) {
    document.getElementById('hAgentBody').innerHTML = res.pcOnline === false
      ? hPcAbsentBanner('ce sous-agent')
      : `<div class="empty-state"><div class="t">Sous-agent introuvable</div></div>`;
    return;
  }
  document.getElementById('hAgentTitle').textContent = a.name;
  document.getElementById('hAgentSub').textContent = `${m.project} · sous-agent de ${m.id.toUpperCase()}`;
  const color = a.status === 'actif' ? 'background:var(--ok-soft);color:var(--ok);' : a.status === 'attente' ? 'background:var(--warn-soft);color:#8A6A12;' : 'background:var(--bg-2);color:var(--ink-3);';
  document.getElementById('hAgentBadge').style.cssText = color;
  document.getElementById('hAgentBadge').textContent = a.status;

  // H-72.4 mesuré : le flux best-effort peut livrer 0 ligne pour un sous-agent sain.
  // On l'affiche honnêtement plutôt que de laisser croire à un flux complet.
  // ☠ Le MÊME rendu que le lead, par le même code — pas une copie. Cette page
  // appelait `hFeedItemTemplate`, disparu à la refonte de la page mission : la
  // vue tombait sur une ReferenceError et rendait une page blanche, sans que
  // rien n'échoue ailleurs. Passer par `hCorpsFil` fait de « même niveau de
  // détail que le lead » (H-72) une conséquence du code plutôt qu'une promesse.
  const feedNote = a.feedUnavailable
    ? `<div class="empty-state"><div class="t">Détail temps réel indisponible</div><div class="s">Le flux best-effort n'a rien livré pour cet agent (mesuré H-72.4 : 0 à 4 lignes sur 5 agents, d'une exécution à l'autre, même sur session saine). L'agent existe et travaille — seul son détail en direct manque ici.</div></div>`
    : hCorpsFil({ feed: a.feed || [] });

  document.getElementById('hAgentBody').innerHTML = `
    ${hPcAbsentBanner('ce sous-agent')}
    <div class="card" style="padding:14px;margin-bottom:14px;background:var(--bg-2);">
      <div style="font-size:11px;color:var(--ink-3);">Invoqué par le team leader de <strong style="color:var(--ink-2);">${escapeHtml(m.title)}</strong> — même niveau de détail que le lead (H-72).</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:9px;" onclick="hGoToMission('${m.id}')">← Retour à l'équipe</button>
    </div>
    <div class="card" style="padding:14px;margin-bottom:14px;">
      <div class="sec-title">Ce qu'il fait, où il en est</div>
      <p style="font-size:13px;line-height:1.55;margin:0;">${escapeHtml(a.action)}</p>
      <div class="kv" style="margin-top:11px;">
        <div><span class="k">Rôle</span><span class="v">${a.role}</span></div>
        <div><span class="k">Rattaché à</span><span class="v mono">${m.project} · ${m.id}</span></div>
      </div>
    </div>
    <div class="card" style="padding:14px;">
      <div class="sec-title">Travail en temps réel <span class="badge" style="background:var(--bg-2);color:var(--ink-3);">${(a.feed || []).length} évènements</span></div>
      <div class="feed-scroll" id="hAgentFeedScroll">${feedNote}</div>
      <div style="font-size:10px;color:var(--ink-3);margin-top:8px;line-height:1.5;">
        Flux directement depuis la source vers cette vue — il ne transite jamais par le contexte de l'orchestrateur maître ni d'un autre agent (H-45, H-72.1).
      </div>
    </div>
  `;
  const scroll = document.getElementById('hAgentFeedScroll');
  if (scroll) {
    scroll.scrollTop = scroll.scrollHeight;
    // Même flèche que les deux autres fils — H-72.1 vaut aussi pour le confort
    // de lecture : un sous-agent se consulte comme un lead.
    window.HFilBas?.attacher(scroll);
  }
}
