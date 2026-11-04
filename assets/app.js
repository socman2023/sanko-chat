(() => {
  'use strict';

  // The empty API setting is a deliberately honest UI preview, not an AI chat.
  const candidate = String(window.SANKO_CONFIG?.apiUrl || '').trim();
  let API = '';
  try {
    if (candidate) {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'https:' && parsed.pathname.endsWith('/api/chat') &&
          parsed.hostname !== 'oleshka-chat-api.boysinger2008.workers.dev') API = parsed.href;
    }
  } catch (_) {}
  const PREVIEW = !API;
  const STORAGE_KEY = 'sanko-native-chat-v1';
  const LAST_GREETING_KEY = 'sanko-last-greeting-v1';
  const MAX_SAVED = 80;
  const MAX_CONTEXT = 12;
  // Static opening lines are UI text, not Gemini replies. Keep them
  // short and recognizably Sanko; never claim events or dates in greetings.
  const GREETINGS = [
    'Здрав будь! Шо хотел спросить?',
    'Здрав будь. Шо у тебя нового?',
    'Здрав будь. Ну, говори.'
  ];
  // These are newly written UI examples, NOT quotations from the books.

  const el = id => document.getElementById(id);
  const messages = el('messages'), input = el('input'), form = el('composer');
  const send = el('send'), newButton = el('new-chat'), dialog = el('new-dialog');
  const confirmNew = el('confirm-new'), errorBox = el('error');
  let conversation = [], conversationId = '', greetingId = 0, focusDate = '';
  let limitUntil = 0, busy = false, visitorRole = 'stranger', visitorName = '';
  let warnedPreview = false;
  let unlockTimer = 0;
  let vkFirstName = '', vkFirstNameUserId = 0;
  const FAILURE_NOTICE = 'Связь не ладится. Загляни погодя, ладно?';

  function makeId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, v => v.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8)+'-'+h.slice(8, 12)+'-'+h.slice(12, 16)+'-'+h.slice(16, 20)+'-'+h.slice(20);
  }
  function chooseGreeting(previous = 0) {
    const choices = GREETINGS.map((_, i) => i + 1).filter(i => i !== previous);
    const raw = new Uint32Array(1);
    crypto.getRandomValues(raw);
    const next = choices[raw[0] % choices.length];
    try { localStorage.setItem(LAST_GREETING_KEY, String(next)); } catch (_) {}
    return next;
  }
  function greeting() {
    const text = GREETINGS[greetingId - 1] || GREETINGS[0];
    // A name is shown only after /api/session confirms a signed VK launch.
    // This is a personal greeting, not an invented memory of prior chats.
    if (visitorRole === 'friend' && visitorName) {
      return 'О, ' + visitorName + '! Здрав будь. Шо у тебя нового?';
    }
    if (visitorRole === 'follower' && visitorName) {
      return 'Здрав будь, ' + visitorName + '! Шо тебе рассказать?';
    }
    if (visitorRole === 'community' && visitorName) {
      return 'Здрав будь, ' + visitorName + '! Шо спросить хотел?';
    }
    return text;
  }
  function loadSaved() {
    if (PREVIEW) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (Array.isArray(saved.messages)) {
        conversation = saved.messages.filter(m => m && (m.role === 'user' || m.role === 'model' || m.role === 'notice') &&
          typeof m.text === 'string').slice(-MAX_SAVED);
      }
      if (typeof saved.conversationId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.conversationId)) {
        conversationId = saved.conversationId;
      }
      if (typeof saved.focusDate === 'string') focusDate = saved.focusDate.slice(0, 10);
      if (Number.isInteger(saved.greetingId) && saved.greetingId > 0 && saved.greetingId <= GREETINGS.length) {
        greetingId = saved.greetingId;
      }
      if (Number.isFinite(saved.limitUntil) && saved.limitUntil > Date.now()) limitUntil = saved.limitUntil;
    } catch (_) { conversation = []; }
  }
  function save() {
    if (PREVIEW) return; // Test inputs never pollute real conversation history.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        messages: conversation.slice(-MAX_SAVED), conversationId, greetingId, focusDate, limitUntil
      }));
    } catch (_) {} // Private browsing: the live chat still works.
  }
  function error(message = '') {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }
  function bubble(role, text, pending = false) {
    const wrap = document.createElement('div');
    wrap.className = 'message ' + (role === 'notice' ? 'model' : role) + (pending ? ' pending' : '');
    const byline = document.createElement('div');
    byline.className = 'byline';
    byline.textContent = role === 'user' ? 'Ты' : role === 'notice' && PREVIEW ? 'Проверка интерфейса' : 'Санко';
    const body = document.createElement('div');
    body.className = 'bubble';
    body.textContent = text; // Untrusted content is never interpreted as HTML.
    wrap.append(byline, body);
    messages.append(wrap);
    messages.scrollTop = messages.scrollHeight;
    return wrap;
  }
  function addNotice(text) {
    bubble('notice', text);
    conversation.push({role:'notice',text});
    conversation = conversation.slice(-MAX_SAVED);
    save();
  }
  function render() {
    messages.replaceChildren();
    if (!conversation.some(m => m.role === 'user' || m.role === 'model')) bubble('model', greeting());
    conversation.forEach(m => bubble(m.role, m.text));
  }
  function resize() {
    input.style.height = 'auto';
    input.style.height = Math.min(Math.max(input.scrollHeight, 48), 150) + 'px';
  }
  function setBusy(value) {
    busy = value;
    newButton.disabled = value;
    input.disabled = value;
    send.disabled = value;
  }
  function applyLimitLock() {
    if (unlockTimer) clearTimeout(unlockTimer);
    unlockTimer = 0;
    if (busy) return;
    const remaining = limitUntil - Date.now();
    if (remaining > 0) {
      input.disabled = true; send.disabled = true;
      unlockTimer = setTimeout(applyLimitLock, Math.min(60000,remaining+100));
    } else {
      if (limitUntil) { limitUntil = 0; save(); }
      input.disabled = false; send.disabled = false;
    }
  }
  window.addEventListener('focus', applyLimitLock);
  // Only signed VK launch parameters are forwarded for SERVER-SIDE verification.
  // Their presence changes layout only; it never grants a visitor a role.
  function signedVkLaunch() {
    const qs = new URLSearchParams(window.location.search);
    return qs.has('vk_user_id') && qs.has('vk_app_id') && qs.has('sign')
      ? window.location.search : '';
  }
  const vkLaunch = signedVkLaunch();
  const IN_VK = Boolean(vkLaunch);

  function updateVkInsets(value) {
    if (!IN_VK || !value || typeof value !== 'object') return;
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const num = Number(value[side]);
      if (!Number.isFinite(num) || num < 0 || num > 150) continue;
      document.documentElement.style.setProperty('--vk-inset-' + side, Math.round(num) + 'px');
    }
  }
  function syncVkViewport() {
    if (!IN_VK) return;
    const height = Number(window.visualViewport?.height || window.innerHeight);
    if (Number.isFinite(height) && height >= 180) {
      document.documentElement.style.setProperty('--vk-visible-height', Math.round(height) + 'px');
    }
  }
  if (IN_VK) {
    document.documentElement.classList.add('vk-embedded');
    syncVkViewport();
    window.addEventListener('resize', syncVkViewport);
    window.visualViewport?.addEventListener('resize', syncVkViewport);
  }

  function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('VK operation timeout')), ms);
      })
    ]).finally(() => clearTimeout(timer));
  }

  async function initVk() {
    if (!IN_VK || PREVIEW) return;

    // The chat is already rendered; slow, missing or blocked VK Bridge
    // must never leave visitors staring at an empty window.
    const bridge = window.vkBridge;
    if (bridge && typeof bridge.send === 'function') {
      if (typeof bridge.subscribe === 'function') {
        try {
          bridge.subscribe(event => {
            if (event?.detail?.type === 'VKWebAppUpdateConfig') {
              updateVkInsets(event.detail.data?.insets);
            }
          });
        } catch (_) {}
      }

      try {
        await withTimeout(bridge.send('VKWebAppInit'), 1600);
        // Optional: some VK clients report insets in the config response;
        // other clients send VKWebAppUpdateConfig asynchronously.
        const config = await withTimeout(bridge.send('VKWebAppGetConfig'), 1600).catch(() => null);
        updateVkInsets(config?.insets);
      } catch (_) { /* VK platform initialization failure is nonfatal. */ }

      try {
        const signedId = Number(new URLSearchParams(vkLaunch.slice(1)).get('vk_user_id'));
        const info = await withTimeout(bridge.send('VKWebAppGetUserInfo'), 2500);
        if (Number(info?.id) === signedId && typeof info?.first_name === 'string') {
          vkFirstName = info.first_name;
          vkFirstNameUserId = signedId;
        }
      } catch (_) {}
    }

    // This endpoint validates the VK launch signature WITH THE APP SECRET
    // stored in Cloudflare. Browser-supplied names / statuses are untrusted.
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6500);
    try {
      const response = await fetch(API.replace(/\/api\/chat$/, '/api/session'), {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({vkLaunch, vkFirstName, vkFirstNameUserId}),
        signal: ctl.signal
      });
      if (response.ok) {
        const result = await response.json();
        if (result.verified === true &&
            ['friend', 'follower', 'community', 'stranger'].includes(result.role)) {
          visitorRole = result.role;
          if (typeof result.firstName === 'string') visitorName = result.firstName.slice(0, 45);
          if (!conversation.some(m => m.role === 'user' || m.role === 'model')) render();
        }
      }
    } catch (_) { /* Never infer friends/followers from an unsigned response. */ }
    finally { clearTimeout(t); }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || busy) return;
    error('');
    if (PREVIEW) {
      conversation.push({role:'user', text:question});
      if (!warnedPreview) {
        conversation.push({role:'notice',
          text:'Это только проверка оформления. Сообщение Санко не отправлено: его сервер ещё не подключён.'});
        warnedPreview = true;
      }
      input.value = '';
      resize();
      render();
      input.focus();
      return;
    }
    if (limitUntil > Date.now()) { error(''); return; }
    if (limitUntil) limitUntil = 0;

    const history = conversation.filter(m => m.role === 'user' || m.role === 'model').slice(-MAX_CONTEXT);
    const userNode = bubble('user', question);
    const pending = bubble('model', 'Пишет…', true);
    input.value = '';
    resize();
    setBusy(true);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 75000);
    try {
      const response = await fetch(API, {
        method:'POST', headers:{'Content-Type':'application/json'}, signal:ctl.signal,
        body:JSON.stringify({message:question, history, focusDate, conversationId,
          greetingId, vkLaunch, vkFirstName, vkFirstNameUserId})
      });
      // A non-JSON Cloudflare error must never expose HTML or a technical message.
      const data = await response.json().catch(() => null);
      if (response.status === 429 && data?.error === 'quota_exhausted') {
        pending.remove(); userNode.remove();
        input.value = question; resize();
        addNotice(typeof data.reply === 'string' && data.reply.trim() ?
          data.reply : 'На сегодня разговоров у меня уже через край. Завтра продолжим.');
        if (Number.isFinite(Number(data.retryAt)) && Number(data.retryAt) > Date.now())
          limitUntil = Number(data.retryAt);
        save();
        return;
      }
      if (!response.ok) {
        pending.remove(); userNode.remove();
        input.value = question; resize();
        const allowed = ['provider_quota','provider_busy','service_unavailable',
          'response_blocked'].includes(data?.error);
        addNotice(allowed && typeof data?.reply === 'string' && data.reply.trim() ?
          data.reply : FAILURE_NOTICE);
        return;
      }
      if (typeof data?.reply !== 'string' || !data.reply.trim()) {
        throw new Error('empty_response');
      }
      pending.remove();
      bubble('model', data.reply);
      conversation.push({role:'user',text:question},{role:'model',text:data.reply});
      conversation = conversation.slice(-MAX_SAVED);
      focusDate = typeof data.knowledge?.focusDate === 'string' ? data.knowledge.focusDate : '';
      if (typeof data.conversationId === 'string' &&
          /^[0-9a-f-]{36}$/i.test(data.conversationId)) conversationId = data.conversationId;
      save();
    } catch (ex) {
      pending.remove(); userNode.remove();
      input.value = question; resize();
      addNotice(FAILURE_NOTICE);
    } finally {
      clearTimeout(t);
      setBusy(false);
      applyLimitLock();
      if (!input.disabled && !IN_VK) input.focus();
    }
  });
  input.addEventListener('input', resize);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  function clearChat() {
    conversation = []; focusDate = ''; warnedPreview = false;
    conversationId = makeId();
    greetingId = chooseGreeting(greetingId);
    if (!PREVIEW) { try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} }
    save(); error(''); input.value=''; render(); resize();
    applyLimitLock();
    if (!input.disabled && !IN_VK) input.focus();
  }
  newButton.addEventListener('click', () => {
    if (busy) return;
    if (!conversation.length) { clearChat(); return; }
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else if (window.confirm('Удалить прежнюю переписку и начать новый разговор?')) clearChat();
  });
  confirmNew.addEventListener('click', clearChat);
  async function start() {
    loadSaved();
    if (!conversationId) conversationId = makeId();
    if (!greetingId) {
      let prev = 0;
      try { prev = Number(localStorage.getItem(LAST_GREETING_KEY)) || 0; } catch (_) {}
      greetingId = chooseGreeting(prev);
    }
    render(); resize(); save();
    applyLimitLock();
    if (!PREVIEW && IN_VK) void initVk();
  }
  input.disabled = true; send.disabled = true;
  start().catch(() => { render(); resize(); applyLimitLock(); });
})();