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
  if (state.currentConvId) persistCurrentConversation();
  state.chatHistory = [];
  state.currentConvId = null;
  state.convTitle = null;
  messagesInner.innerHTML = `<div class="text-center pt-4 pb-2 msg-in"><h2 class="serif text-[22px] font-medium mb-1.5" style="color: var(--ink);">Nouvelle conversation</h2><p class="text-[13.5px]" style="color: var(--ink-3);">Que voulez-vous faire ?</p></div>`;
  renderConversationList();
  refreshContextUsage();
  showToast('Nouvelle conversation créée', 'ok');
});

function scrollBottom() { setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 50); }

function renderMarkdown(text) {
  if (!window.marked || !window.DOMPurify) return escapeHtml(text || '');
  return DOMPurify.sanitize(marked.parse(text || ''));
}

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
  div.innerHTML = `<div class="flex gap-3.5"><div class="shrink-0 w-7 h-7 rounded-md flex items-center justify-center" style="background: var(--accent);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.5"/></svg></div><div class="flex-1 min-w-0 space-y-3 stream-content">${html}</div></div>`;
  messagesInner.appendChild(div);
  bindDynamicElements(div);
  scrollBottom();
  return div.querySelector('.stream-content');
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

function mdBlock(text) { return `<div class="md text-[14px] leading-relaxed" style="color: var(--ink);">${renderMarkdown(text)}</div>`; }
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

// ============ CONVERSATIONS PERSISTANTES ============
function loadConversations() {
  try { return JSON.parse(localStorage.getItem('ccr_conversations') || '[]'); } catch { return []; }
}
function saveConversations(list) { localStorage.setItem('ccr_conversations', JSON.stringify(list.slice(0, 40))); }
function newConversationId() { return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

function persistCurrentConversation() {
  if (!state.currentConvId) return;
  const list = loadConversations();
  const idx = list.findIndex(c => c.id === state.currentConvId);
  const entry = {
    id: state.currentConvId,
    title: state.convTitle || 'Conversation',
    updatedAt: Date.now(),
    apiHistory: state.chatHistory,
    displayHtml: messagesInner.innerHTML,
  };
  if (idx >= 0) list[idx] = entry; else list.unshift(entry);
  saveConversations(list);
  renderConversationList();
}

function resumeConversation(id) {
  const conv = loadConversations().find(c => c.id === id);
  if (!conv) return;
  state.currentConvId = conv.id;
  state.convTitle = conv.title;
  state.chatHistory = conv.apiHistory || [];
  messagesInner.innerHTML = conv.displayHtml;
  bindDynamicElements(messagesInner);
  switchView('agent');
  renderConversationList();
  refreshContextUsage();
  scrollBottom();
}

function deleteConversation(id) {
  const list = loadConversations().filter(c => c.id !== id);
  saveConversations(list);
  if (state.currentConvId === id) {
    state.chatHistory = [];
    state.currentConvId = null;
    state.convTitle = null;
    messagesInner.innerHTML = `<div class="text-center pt-4 pb-2 msg-in"><h2 class="serif text-[22px] font-medium mb-1.5" style="color: var(--ink);">Nouvelle conversation</h2><p class="text-[13.5px]" style="color: var(--ink-3);">Que voulez-vous faire ?</p></div>`;
    refreshContextUsage();
  }
  renderConversationList();
}

function renderConversationList() {
  const el = document.getElementById('convList');
  if (!el) return;
  const list = loadConversations();
  if (list.length === 0) {
    el.innerHTML = `<div class="px-2.5 py-1.5 text-[11.5px]" style="color: var(--ink-3);">Aucune conversation enregistrée</div>`;
    return;
  }
  el.innerHTML = list.map(c => `
    <div class="conv-item group w-full px-2.5 py-1.5 rounded-md text-[12.5px] flex items-center justify-between gap-1.5 cursor-pointer ${c.id === state.currentConvId ? 'nav-item active' : ''}" data-id="${c.id}" style="color: var(--ink-2);">
      <span class="truncate">${escapeHtml(c.title)}</span>
      <button class="conv-delete shrink-0 p-0.5 rounded hover:bg-black/10 opacity-0 group-hover:opacity-100" data-id="${c.id}" title="Supprimer">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color: var(--ink-3);"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join('');
  el.querySelectorAll('.conv-item').forEach(row => row.addEventListener('click', (e) => {
    if (e.target.closest('.conv-delete')) return;
    resumeConversation(row.dataset.id);
  }));
  el.querySelectorAll('.conv-delete').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteConversation(btn.dataset.id);
  }));
}

// ============ STREAMING ============
function renderStreamState(container, st) {
  let html = '';
  if (st.reasoning) html += thinkBlock(st.reasoning);
  html += st.toolsHtml;
  if (st.content) html += mdBlock(st.content);
  container.innerHTML = html;
  bindDynamicElements(container);
  scrollBottom();
}

async function sendMessage() {
  if (state.agentBusy) { showToast('L\'agent traite déjà une demande…', 'warn'); return; }
  const text = chatInput.value.trim();
  if (!text) return;
  if (!state.currentConvId) {
    state.currentConvId = newConversationId();
    state.convTitle = text.length > 42 ? text.slice(0, 42) + '…' : text;
  }
  addUserMessage(text);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  state.agentBusy = true;
  showTyping();

  const st = { reasoning: '', content: '', toolsHtml: '' };
  let container = null;
  let finalHistory = state.chatHistory;

  try {
    const res = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message: text, history: state.chatHistory, model: prefs.model }),
    });
    if (!res.ok || !res.body) throw new Error(`/api/agent/chat -> ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        if (!part.startsWith('data: ')) continue;
        const event = JSON.parse(part.slice(6));
        if (!container && (event.type === 'content_delta' || event.type === 'reasoning_delta' || event.type === 'tool_call')) {
          hideTyping();
          container = addAssistantBlock('');
        }
        if (event.type === 'compacted') {
          showToast('Conversation compactée pour respecter le contexte du modèle', 'warn');
          addHistory('tool', 'Conversation compactée', 'Résumé automatique appliqué');
        } else if (event.type === 'key_rotated') {
          showToast('Quota atteint — bascule automatique vers la clé API de secours', 'warn');
          addHistory('tool', 'Clé API basculée', `${event.from} → ${event.to}`);
        } else if (event.type === 'reasoning_delta') {
          st.reasoning += event.text;
          renderStreamState(container, st);
        } else if (event.type === 'content_delta') {
          st.content += event.text;
          renderStreamState(container, st);
        } else if (event.type === 'tool_call') {
          st.toolsHtml += toolBlock(event);
          renderStreamState(container, st);
          addHistory('tool', historyLabelFor(event), JSON.stringify(event.result).slice(0, 80));
        } else if (event.type === 'done') {
          hideTyping();
          if (!container) container = addAssistantBlock('');
          st.content = event.reply || st.content;
          renderStreamState(container, st);
          finalHistory = event.history || finalHistory;
          if (event.usage) { renderContextUsage(event.usage); renderQuotaUsage(event.usage); }
        }
      }
    }
    state.chatHistory = finalHistory;
    persistCurrentConversation();
  } catch (e) {
    hideTyping();
    addAssistantBlock(textBlock('Erreur de communication avec l\'agent : ' + e.message));
  }
  state.agentBusy = false;
}

renderConversationList();
