// ============ AGENT CHAT ============
const chatInput = document.getElementById('chatInput');
const messagesEl = document.getElementById('messages');
const messagesInner = document.getElementById('messagesInner');

const TOOL_META = {
  get_status: { label: 'Vérification du statut', icon: '<circle cx="12" cy="12" r="10"/><path d="M22 12h-4"/><circle cx="12" cy="12" r="3"/>' },
  get_metrics: { label: 'Lecture des performances', icon: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0z"/>' },
  list_sessions: { label: 'Liste des sessions', icon: '<rect x="2" y="3" width="20" height="14" rx="2"/>' },
  launch_session: { label: 'Lancement de session', icon: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>' },
  kill_session: { label: 'Arrêt de session', icon: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' },
  capture_pane: { label: 'Lecture du terminal', icon: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>' },
  send_keys: { label: 'Envoi de touches', icon: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>' },
  wake_pc: { label: 'Wake-on-LAN', icon: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>' },
};

chatInput.addEventListener('input', () => { chatInput.style.height = 'auto'; chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px'; });
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.querySelectorAll('.suggestion').forEach(b => b.addEventListener('click', () => { chatInput.value = b.textContent; chatInput.focus(); chatInput.dispatchEvent(new Event('input')); }));

document.getElementById('newChatBtn').addEventListener('click', () => {
  state.chatHistory = [];
  messagesInner.innerHTML = `<div class="text-center pt-4 pb-2 msg-in"><h2 class="serif text-[22px] font-medium mb-1.5" style="color: var(--ink);">Nouvelle conversation</h2><p class="text-[13.5px]" style="color: var(--ink-3);">Que voulez-vous faire ?</p></div>`;
  showToast('Nouvelle conversation créée', 'ok');
});

function scrollBottom() { setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 50); }

function addUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg-in flex justify-end';
  div.innerHTML = `<div class="max-w-[80%] rounded-2xl rounded-tr-md px-4 py-2.5 text-[13.5px] leading-relaxed" style="background: var(--ink); color: var(--bg);">${escapeHtml(text)}</div>`;
  messagesInner.appendChild(div);
  scrollBottom();
}

function addAssistantBlock(html) {
  const div = document.createElement('div');
  div.className = 'msg-in';
  div.innerHTML = `<div class="flex gap-3.5"><div class="shrink-0 w-7 h-7 rounded-md flex items-center justify-center" style="background: var(--accent);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.5"/></svg></div><div class="flex-1 min-w-0 space-y-3">${html}</div></div>`;
  messagesInner.appendChild(div);
  bindDynamicElements(div);
  scrollBottom();
  return div;
}

function showTyping() {
  const div = document.createElement('div');
  div.id = 'typingRow';
  div.className = 'msg-in flex gap-3.5';
  div.innerHTML = `<div class="shrink-0 w-7 h-7 rounded-md flex items-center justify-center" style="background: var(--accent);"></div><div class="flex items-center gap-1.5 pt-2"><span class="typing-dot w-1.5 h-1.5 rounded-full" style="background: var(--ink-3);"></span><span class="typing-dot w-1.5 h-1.5 rounded-full" style="background: var(--ink-3);"></span><span class="typing-dot w-1.5 h-1.5 rounded-full" style="background: var(--ink-3);"></span></div>`;
  messagesInner.appendChild(div);
  scrollBottom();
}
function hideTyping() { const t = document.getElementById('typingRow'); if (t) t.remove(); }

function thinkBlock(text) {
  return `<div class="think rounded-lg">
    <button class="think-toggle w-full flex items-center gap-2 px-3.5 py-2.5 text-left">
      <svg class="think-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--ink-3);"><polyline points="6 9 12 15 18 9"/></svg>
      <span class="text-[11.5px] font-medium uppercase tracking-wider" style="color: var(--ink-3);">Réflexion</span>
    </button>
    <div class="think-body px-3.5 pb-3.5 pt-0"><div class="pl-5 border-l-2 text-[13px] italic leading-relaxed serif" style="border-color: var(--line-2); color: var(--ink-2);">${escapeHtml(text)}</div></div>
  </div>`;
}

function toolBlock(trace) {
  const meta = TOOL_META[trace.name] || { label: trace.name, icon: '<circle cx="12" cy="12" r="10"/>' };
  const isError = trace.result && trace.result.status === 'error';
  const toolClass = isError ? 'tool-error' : 'tool-success';
  const badge = isError
    ? `<span class="badge" style="background: var(--err-soft); color: var(--err);">échec</span>`
    : `<span class="badge" style="background: var(--ok-soft); color: var(--ok);">terminé</span>`;
  const argsStr = Object.keys(trace.args || {}).length ? JSON.stringify(trace.args) : '';
  const resultStr = JSON.stringify(trace.result, null, 2);
  return `<div class="tool ${toolClass}">
    <div class="flex items-center gap-3 px-3.5 py-2.5">
      <div class="shrink-0 w-7 h-7 rounded-md flex items-center justify-center" style="background: var(--bg-2);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="color: var(--ink-2);">${meta.icon}</svg></div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2"><span class="text-[12.5px] font-medium mono" style="color: var(--ink);">${trace.name}</span>${badge}</div>
        <div class="text-[11.5px] mt-0.5 truncate" style="color: var(--ink-3);">${meta.label}${argsStr ? ' · ' + escapeHtml(argsStr) : ''}</div>
      </div>
      <button class="tool-expand p-1 rounded hover:bg-black/5"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--ink-3);"><polyline points="6 9 12 15 18 9"/></svg></button>
    </div>
    <div class="tool-body ${prefs.verbose ? '' : 'hidden'} border-t px-3.5 py-3" style="border-color: var(--line);">
      <div class="codeblock p-2.5 text-[12px]">${escapeHtml(resultStr)}</div>
    </div>
  </div>`;
}

function textBlock(text) { return `<p class="text-[14px] leading-relaxed" style="color: var(--ink);">${escapeHtml(text)}</p>`; }

function bindDynamicElements(container) {
  container.querySelectorAll('.think-toggle').forEach(btn => {
    if (!prefs.think) btn.closest('.think').classList.add('collapsed');
    btn.addEventListener('click', () => btn.closest('.think').classList.toggle('collapsed'));
  });
  container.querySelectorAll('.tool-expand').forEach(btn => btn.addEventListener('click', () => {
    const body = btn.closest('.tool').querySelector('.tool-body');
    body.classList.toggle('hidden');
  }));
}

function historyLabelFor(trace) {
  const meta = TOOL_META[trace.name] || { label: trace.name };
  return meta.label;
}

async function sendMessage() {
  if (state.agentBusy) { showToast('L\'agent traite déjà une demande…', 'warn'); return; }
  const text = chatInput.value.trim();
  if (!text) return;
  addUserMessage(text);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  state.agentBusy = true;
  showTyping();
  try {
    const resp = await api('POST', '/api/agent/chat', { message: text, history: state.chatHistory, model: prefs.model });
    hideTyping();
    state.chatHistory = resp.history || [];
    let html = '';
    (resp.reasoning || []).forEach(r => { html += thinkBlock(r); });
    (resp.tool_calls || []).forEach(t => { html += toolBlock(t); addHistory('tool', historyLabelFor(t), JSON.stringify(t.result).slice(0, 80)); });
    html += textBlock(resp.reply || '');
    addAssistantBlock(html);
  } catch (e) {
    hideTyping();
    addAssistantBlock(textBlock('Erreur de communication avec l\'agent : ' + e.message));
  }
  state.agentBusy = false;
}
