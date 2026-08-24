// ============ HARNESS — vue Comptes & quotas ============

function hAccountBlock(a, missionsForAccount) {
  if (!a) return '';
  const isActive = a.status === 'allowed';
  const rows = [];
  if (a.five_hour) rows.push(['five_hour (session actuelle)', a.five_hour, true]);
  if (a.seven_day) rows.push(['seven_day (semaine)', a.seven_day, false]);
  const qrows = rows.map(([name, w, activeWin]) => `
    <div class="qrow">
      <div class="qh"><span style="color:var(--ink-3);">${name}${activeWin ? ' <span class="badge" style="background:var(--ink);color:var(--bg);margin-left:4px;">fenêtre active</span>' : ''}</span><span>${w.util} %</span></div>
      <div class="usage-track"><div class="usage-fill" style="width:${w.util}%;background:${w.util >= 90 ? 'var(--err)' : w.util >= 65 ? 'var(--warn)' : 'var(--ok)'};"></div></div>
      <div class="mono" style="font-size:10px;color:${w.util >= 90 ? 'var(--err)' : 'var(--ink-3)'};margin-top:4px;">${w.util >= 90 ? 'saturé · ' : ''}reset ${w.resetLabel}${w.resetAt ? ` · ${w.resetAt}` : ''}</div>
    </div>`).join('');

  return `<div class="card acc ${isActive ? 'active' : 'saturated'}">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
      <div style="min-width:0;"><div style="font-size:13.5px;font-weight:600;">${a.label}</div><div class="mono" style="font-size:10.5px;color:var(--ink-3);margin-top:3px;">${a.email || 'identité non mesurée'}${a.plan ? ' · ' + a.plan : ''}</div></div>
      <span class="badge" style="${isActive ? 'background:var(--ok-soft);color:var(--ok);' : 'background:var(--err-soft);color:var(--err);'}">${a.status}</span>
    </div>
    ${a.isUsingOverage ? `<div style="margin-top:9px;padding:9px 11px;border-radius:10px;background:var(--warn-soft);font-size:11px;color:#8A6A12;line-height:1.5;">
      <strong>En dépassement — sur les crédits (extra_usage, H-69).</strong> Le quota d'abonnement a rejeté (<span class="mono">status: rejected</span>) mais la session continue, silencieusement (<span class="mono">isUsingOverage: true</span>, H-63.1).
    </div>` : ''}
    ${qrows}
    ${hBandeauChoix(a)}
    <div class="qmiss">
      <span style="font-size:10.5px;color:var(--ink-3);align-self:center;">missions :</span>
      ${missionsForAccount.length ? missionsForAccount.map((m) => `<span class="chip" style="${isActive ? '' : 'background:var(--err-soft);color:var(--err);'}">${m.project}${m.landing && m.landing.active ? ' (atterrit)' : ''}</span>`).join('') : '<span class="chip">aucune</span>'}
    </div>
    <div class="mono" style="font-size:9.5px;color:var(--ink-3);margin-top:9px;">consommé sur la fenêtre courante : ${hMoney(a.costWindow)}${typeof a.costWindow === 'number' ? ' · poussé par rate_limit_event' : ' · non mesuré (aucune session active)'}</div>
    <!-- ☠ Bouton de simulation retiré le 22/07/2026 : il mutait l'état de
         DÉMONSTRATION, que cette vue n'affiche plus. Le laisser aurait produit
         un bouton qui plante, ou pire, qui semble agir sur un vrai compte. -->
  </div>`;
}

// ============ Choix manuel du compte + verrou ============
// ☠ MESURÉ LE 24/08. Le harness annonçait « abonnement fini » sur un compte
// remplacé huit jours plus tôt : le registre gardait un verdict `rejected` sur
// une fenêtre morte, et RIEN à l'écran ne permettait de dire « prends l'autre ».
// L'opérateur pouvait constater le mauvais choix, jamais le corriger. Ces deux
// contrôles existent pour ça — et le verrou est strict : verrouillé, aucune
// bascule automatique, même sur saturation.

function hBandeauChoix(a) {
  const choisi = a.selected === true;
  const verrouille = a.locked === true;
  const etat = !choisi
    ? '<span style="color:var(--ink-3);">non utilisé — le harness peut basculer dessus tout seul</span>'
    : verrouille
      ? '<span style="color:var(--ok);font-weight:600;">verrouillé</span> <span style="color:var(--ink-3);">— aucune bascule sans déverrouillage, même saturé</span>'
      : '<span style="font-weight:600;">choisi</span> <span style="color:var(--ink-3);">— bascule encore possible sur saturation</span>';

  const boutonChoix = choisi
    ? `<button class="btn" onclick="hLeverChoixCompte()">Rendre à l'automatique</button>`
    : `<button class="btn" onclick="hChoisirCompte('${a.id}')">Utiliser ce compte</button>`;
  const boutonVerrou = choisi
    ? `<button class="btn" onclick="hBasculerVerrou('${a.id}', ${verrouille ? 'false' : 'true'})">${verrouille ? 'Déverrouiller' : 'Verrouiller'}</button>`
    : '';

  return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line);">
    <div style="font-size:11px;line-height:1.5;margin-bottom:8px;">${choisi ? (verrouille ? '🔒 ' : '● ') : ''}${etat}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">${boutonChoix}${boutonVerrou}</div>
  </div>`;
}

// ☠ Un avertissement du serveur (jeton jamais relevé, jeton expiré) est AFFICHÉ,
// jamais avalé : c'est la seule chose qui distingue « choisi et jouable » de
// « choisi et mort au démarrage » — la confusion exacte du compte-b du VPS.
async function hAppliquerPreference(compteId, verrouille) {
  const rep = await HarnessAPI.setAccountPreference(compteId, verrouille);
  if (!rep.ok) { showToast(rep.erreur || 'réglage refusé', 'err'); return; }
  showToast(rep.effet || 'préférence enregistrée', 'ok');
  if (rep.avertissement) showToast(rep.avertissement, 'warn');
  await hRenderComptes();
}

async function hChoisirCompte(id) { await hAppliquerPreference(id, false); }
async function hLeverChoixCompte() { await hAppliquerPreference(null, false); }
async function hBasculerVerrou(id, verrouille) { await hAppliquerPreference(id, verrouille); }

async function hRenderComptes() {
  const el = document.getElementById('hComptesBody');
  // ☠ Liste d'identifiants texte côté serveur réel, pas un objet indexé 1/2.
  const accounts = hListeComptes(await HarnessAPI.getAccounts());
  if (accounts === null) { el.innerHTML = hPcAbsentBanner('les comptes'); return; }
  const missionsRes = await HarnessAPI.getMissions();
  const missions = missionsRes.data || [];
  const byAcc = (id) => missions.filter((m) => m.account === id && ['running', 'requires_action', 'idle', 'paused'].includes(m.state));

  // Un écran blanc ne dit rien ; celui-ci dit quoi faire.
  const blocs = accounts.length === 0
    ? `<div class="card" style="padding:14px;"><div class="sec-title">Aucun compte enregistré</div>
       <div style="font-size:12px;color:var(--ink-3);line-height:1.55;">
         Le registre du control plane ne contient encore aucun compte Claude. Les quotas
         apparaîtront dès qu'une mission en aura utilisé un.</div></div>`
    : accounts.map((a) => hAccountBlock(a, byAcc(a.id))).join('');

  el.innerHTML = `
    ${blocs}
    <div class="card" style="padding:14px;margin-top:6px;">
      <div class="sec-title">Garde-fous</div>
      <div class="kv">
        <div><span class="k">Paliers d'inspection</span><span class="v mono" style="text-align:right;">12 → 30 → 50 → 70 → 100 → 120 → 150 → 170 → 200 $</span></div>
        <div><span class="k">Juge d'inspection</span><span class="v">Haiku — progrès / incertain / boucle</span></div>
        <div><span class="k">Seuil d'atterrissage</span><span class="v">80-85 % de la fenêtre 5h (H-70)</span></div>
        <div><span class="k">Plafond de parc</span><span class="v">désactivé</span></div>
      </div>
      <div style="font-size:11px;color:var(--ink-3);line-height:1.55;margin-top:10px;">
        H-68 : sur abonnement, le dollar ne borne aucune dépense réelle — il déclenche une inspection. Le vrai bornage du parc reste le rate limit par compte ci-dessus.
      </div>
    </div>`;
  hRenderMiniGauges();
  hRenderQuotaStrip();
}

async function hToggleSaturation(accId) {
  const accRes = await HarnessAPI.getAccounts();
  const a = accRes.data[accId];
  if (a.status === 'allowed') {
    await HarnessAPI.simulateSaturation(accId);
    const missionsRes = await HarnessAPI.getMissions();
    const toLand = (missionsRes.data || []).filter((m) => m.account === accId && ['running', 'requires_action'].includes(m.state));
    for (const m of toLand) await HarnessAPI.simulateLanding(m.id);
    showToast(`Compte #${accId} rejeté sur le quota — bascule sur les crédits (H-69), missions en atterrissage (H-70)`, 'warn');
  } else {
    await HarnessAPI.simulateReset(accId);
    showToast(`Compte #${accId} réinitialisé — de nouveau disponible`, 'ok');
  }
  hRenderComptes(); hRenderParc();
}
