// ============ ÉTAT DU SYSTÈME — une carte par machine de travail ============
//
// ☠ RÉÉCRIT LE 01/08. Cette page lisait `/api/status` + `/api/metrics`, un
// WebSocket LAN vers `pc.exemple:8765` propre au PC de Chris. Ce chemin ne
// peut pas servir une seconde machine : le VPS n'est pas sur le LAN, n'a pas ce
// serveur, et l'y déployer exigerait d'exposer un canal de contrôle de plus sur
// Internet. Les métriques passent maintenant par le LIEN DU HARNESS, déjà
// authentifié et déjà multi-machines — une machine qui se rattache apporte ses
// chiffres sans configuration réseau supplémentaire.
//
// ☠ UNE SEULE SOURCE, y compris pour le PC. Garder l'ancien chemin pour lui et
// le nouveau pour le VPS ferait diverger deux mesures du même hôte — la règle
// est déjà écrite plus bas pour les jauges de quota, elle vaut ici pareil.
// Wake-on-LAN et extinction, eux, restent sur le chemin LAN : ce sont des
// gestes propres au PC, pas des mesures.

let pcViewInterval = null;

// ☠ 3 s et non 2 : chaque passage fait un aller-retour PAR MACHINE, dont un
// jusqu'au VPS à travers Cloudflare. Le gain de fraîcheur ne vaut pas le trafic
// sur un chiffre qu'on regarde quelques secondes.
const PC_INTERVALLE_MS = 3000;

function renderPcView() {
  void fetchAndRenderMetrics();
  void renderPcQuotas();
  clearInterval(pcViewInterval);
  pcViewInterval = setInterval(() => {
    if (!document.querySelector('.view[data-view="pc"].active')) { clearInterval(pcViewInterval); return; }
    void fetchAndRenderMetrics();
  }, PC_INTERVALLE_MS);
}

function pcFmtDuree(s) {
  if (typeof s !== 'number' || s <= 0) return '—';
  const j = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (j > 0) return `${j} j ${h} h`;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

// ☠ `null` s'affiche « — », JAMAIS 0 : « pas mesuré » et « au repos » sont deux
// informations opposées, et c'est sur ces chiffres qu'on choisit où lancer.
function pcVal(v, suffixe = '') {
  return (v === null || v === undefined) ? '—' : `${v}${suffixe}`;
}

function pcTuile(titre, valeur, barrePct) {
  const barre = (typeof barrePct === 'number')
    ? `<div class="mt-2 h-1.5 rounded-full overflow-hidden" style="background: var(--bg-3);">
         <div class="h-full rounded-full" style="background: var(--accent); width: ${Math.max(0, Math.min(100, barrePct))}%; transition: width .5s;"></div>
       </div>`
    : '';
  return `<div class="rounded-xl border p-4" style="border-color: var(--line); background: var(--card);">
      <div class="text-[10.5px] uppercase tracking-wider mb-1" style="color: var(--ink-3);">${titre}</div>
      <div class="flex items-end gap-1.5"><span class="serif text-[24px] font-medium leading-none" style="color: var(--ink);">${valeur}</span></div>
      ${barre}
    </div>`;
}

function pcBlocGpu(gpu) {
  // ☠ Pas de GPU ⇒ AUCUNE section, plutôt qu'une carte à zéro. Le VPS n'en a
  // pas : afficher « 0 % » ferait croire à une carte inactive, pas absente.
  if (!gpu) return '';
  return `<div class="mt-3 rounded-xl border p-4" style="border-color: var(--line); background: var(--card);">
      <div class="flex items-center justify-between mb-3">
        <h4 class="serif text-[14px] font-medium" style="color: var(--ink);">GPU</h4>
        <span class="text-[11px] mono" style="color: var(--ink-3);">${pcVal(gpu.tempC, ' °C')}</span>
      </div>
      <div class="grid grid-cols-2 gap-6">
        <div>
          <div class="text-[11px]" style="color: var(--ink-3);">Utilisation</div>
          <div class="serif text-[20px] font-medium mt-1" style="color: var(--ink);">${pcVal(gpu.utilPct, ' %')}</div>
        </div>
        <div>
          <div class="text-[11px]" style="color: var(--ink-3);">Mémoire</div>
          <div class="serif text-[20px] font-medium mt-1" style="color: var(--ink);">${gpu.memTotaleMo ? `${gpu.memUtiliseeMo}/${gpu.memTotaleMo} Mo` : '—'}</div>
        </div>
      </div>
    </div>`;
}

function pcEnteteMachine(entree, nbEquipes) {
  const uptime = entree.metriques ? pcFmtDuree(entree.metriques.uptimeS) : '—';
  return `<div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2 min-w-0">
        <span class="w-2 h-2 rounded-full shrink-0 ${entree.enLigne ? 'dot-live' : ''}" style="background: ${entree.enLigne ? 'var(--ok)' : 'var(--err)'};"></span>
        <h3 class="serif text-[15px] font-medium truncate" style="color: var(--ink);">${hEchappe(entree.id)}</h3>
      </div>
      <div class="text-[11px] shrink-0" style="color: var(--ink-3);">
        ${entree.enLigne ? `${nbEquipes} équipe${nbEquipes > 1 ? 's' : ''} · uptime ${uptime}` : 'hors ligne'}
      </div>
    </div>`;
}

// ☠ Une machine hors ligne garde SA carte, grisée. La retirer ferait disparaître
// de l'écran une machine sur laquelle des missions vivent — H-75 : l'absence est
// un état, jamais une disparition.
function pcCarteMachine(entree, equipes) {
  const m = entree.metriques;
  const nb = equipes.filter((e) => e.machine === entree.id).length;
  const entete = pcEnteteMachine(entree, nb);

  if (!entree.enLigne || !m) {
    const note = entree.enLigne
      ? 'Machine rattachée, relevé indisponible — le lien répond, la mesure non.'
      : 'Machine hors ligne. Ses missions restent au registre et repartiront à son retour (H-75).';
    return `<div style="opacity:.72;">${entete}
      <div class="rounded-xl border p-4 text-[12.5px]" style="border-color: var(--line); background: var(--card); color: var(--ink-3);">${note}</div>
    </div>`;
  }

  const memTexte = m.memTotaleMo ? `${(m.memUtiliseeMo / 1024).toFixed(1)}/${(m.memTotaleMo / 1024).toFixed(1)} Go` : '—';
  const disqueTexte = m.disqueTotalGo ? `${m.disqueUtiliseGo}/${m.disqueTotalGo} Go` : '—';
  const disquePct = m.disqueTotalGo ? (m.disqueUtiliseGo / m.disqueTotalGo) * 100 : null;
  return `<div>${entete}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      ${pcTuile('CPU', pcVal(m.cpuPct, ' %'), m.cpuPct)}
      ${pcTuile('Mémoire', memTexte, m.memPct)}
      ${pcTuile('Temp. CPU', pcVal(m.tempCpuC, ' °C'))}
      ${pcTuile('Disque', disqueTexte, disquePct)}
    </div>
    ${pcBlocGpu(m.gpu)}
    <div class="mt-3 flex gap-6 text-[11px]" style="color: var(--ink-3);">
      <span>Réseau ↑ ${pcVal(m.reseauMontantKo, ' Ko/s')}</span>
      <span>↓ ${pcVal(m.reseauDescendantKo, ' Ko/s')}</span>
    </div>
  </div>`;
}

function pcMessage(texte) {
  return `<div class="rounded-xl border p-4 text-[12.5px]" style="border-color:var(--line);background:var(--card);color:var(--ink-3);">${texte}</div>`;
}

async function fetchAndRenderMetrics() {
  const hote = document.getElementById('pcMachines');
  if (!hote) return;
  const [rep, missions] = await Promise.all([
    HarnessAPI.getMachineMetrics().catch(() => null),
    HarnessAPI.getMissions().catch(() => null),
  ]);
  const liste = rep && Array.isArray(rep.data) ? rep.data : null;
  const sous = document.getElementById('pcSubHeader');

  if (liste === null) {
    if (sous) sous.textContent = 'Pi injoignable';
    hote.innerHTML = pcMessage('Control plane injoignable — aucun relevé.');
    return;
  }
  if (liste.length === 0) {
    if (sous) sous.textContent = 'Aucune machine rattachée';
    hote.innerHTML = pcMessage("Aucune machine de travail ne s'est connectée au Pi.");
    return;
  }

  const enLigne = liste.filter((m) => m.enLigne).length;
  if (sous) sous.textContent = `${enLigne}/${liste.length} machine${liste.length > 1 ? 's' : ''} en ligne · ${liste.map((m) => m.id).join(', ')}`;

  // Équipes actives, pour dire ce que chaque machine PORTE : une charge CPU
  // seule ne dit pas si le processeur travaille pour le harness ou pour autre
  // chose, et c'est la question qu'on se pose devant cette page.
  const actives = (missions && Array.isArray(missions.data) ? missions.data : [])
    .filter((m) => !['terminee', 'annulee', 'echec', 'echec_definitif'].includes(m.state));
  hote.innerHTML = liste.map((e) => pcCarteMachine(e, actives)).join('');
}

document.getElementById('refreshPc').addEventListener('click', () => { void fetchAndRenderMetrics(); showToast('Données actualisées', 'ok'); });

/**
 * Quotas par compte, sur la page « État du système ».
 *
 * ☠ Réutilise `hAccGaugeMini` plutôt que d'écrire un second rendu : deux
 * représentations d'une même mesure divergent toujours, et c'est sur ces
 * pourcentages qu'on décide de lancer ou non une équipe.
 */
async function renderPcQuotas() {
  const el = document.getElementById('pcQuotas');
  if (!el || typeof hListeComptes !== 'function') return;
  const comptes = hListeComptes(await HarnessAPI.getAccounts());
  if (comptes === null) {
    el.innerHTML = pcMessage('Pi injoignable — quotas indisponibles.');
    return;
  }
  if (comptes.length === 0) {
    el.innerHTML = pcMessage('Aucun compte enregistré dans le registre.');
    return;
  }
  el.innerHTML = `<div class="rounded-xl border p-4" style="border-color: var(--line); background: var(--card);">
      <div class="text-[10.5px] uppercase tracking-wider mb-3" style="color: var(--ink-3);">Quotas par compte (H-72)</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">${comptes.map(hAccGaugeMini).join('')}</div>
    </div>`;
}
