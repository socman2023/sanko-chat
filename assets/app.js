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
  const GREETINGS = [
    'Здрав будь. Я Санко. Шо хотел узнать?',
    'Ну, заходи. Говори, я слушаю.',
    'Привет. Ты про лес хочешь спросить, чи про наши дела?',
    'Здрав будь! Ежли чего не знаю, так и скажу. А ты спрашивай.',
    'А, гость! Ну шо, с чего начнём?',
    'Здрав будь. Только не жди от мене долгих речей. Лучше прямо спрашивай.',
    'Ну, привет. Есть у тебя дело ко мне?',
    'Дивись-ка, кто пожаловал! Здрав будь.'
  ];
  // These are newly written UI examples, NOT quotations from the books.

  const el = id => document.getElementById(id);
  const messages = el('messages'), input = el('input'), form = el('composer');
  const send = el('send'), newButton = el('new-chat'), dialog = el('new-dialog');
  const confirmNew = el('confirm-new'), errorBox = el('error'), status = el('statusline');
  let conversation = [], conversationId = '', greetingId = 0, focusDate = '';
  let limitUntil = 0, busy = false, visitorRole = 'stranger', visitorName = '';
  let warnedPreview = false;
  let vkFirstName = '', vkFirstNameUserId = 0;

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
    if (visitorRole === 'friend' && visitorName) {
      return 'Здрав будь, ' + visitorName + '! ' + text.replace(/^Здрав будь[.! ]*/u, '');
    }
    return text;
  }
  function loadSaved() {
    if (PREVIEW) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (Array.isArray(saved.messages)) {
        conversation = saved.messages.filter(m => m && (m.role === 'user' || m.role === 'model') &&
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
    wrap.className = 'message ' + role + (pending ? ' pending' : '');
    const byline = document.createElement('div');
    byline.className = 'byline';
    byline.textContent = role === 'user' ? 'Ты' : role === 'notice' ? 'Проверка интерфейса' : 'Санко';
    const body = document.createElement('div');
    body.className = 'bubble';
    body.textContent = text; // Untrusted content is never interpreted as HTML.
    wrap.append(byline, body);
    messages.append(wrap);
    messages.scrollTop = messages.scrollHeight;
    return wrap;
  }
  function render() {
    messages.replaceChildren();
    if (!conversation.length) bubble('model', greeting());
    else conversation.forEach(m => bubble(m.role, m.text));
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
  function signedVkLaunch() {
    const qs = new URLSearchParams(window.location.search);
    return qs.has('vk_user_id') && qs.has('vk_app_id') && qs.has('sign') ? window.location.search : '';
  }
  const vkLaunch = signedVkLaunch();

  async function initVk() {
    if (!vkLaunch || PREVIEW) return;
    try {
      if (window.vkBridge?.send) {
        await window.vkBridge.send('VKWebAppInit').catch(() => {});
        const signedId = Number(new URLSearchParams(vkLaunch.slice(1)).get('vk_user_id'));
        const info = await Promise.race([
          window.vkBridge.send('VKWebAppGetUserInfo'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('VK timeout')), 2500))
        ]).catch(() => null);
        if (Number(info?.id) === signedId && typeof info?.first_name === 'string') {
          vkFirstName = info.first_name;
          vkFirstNameUserId = signedId;
        }
      }
      // VK role is trusted ONLY if the server verifies the signed launch params.
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
          }
        }
      } finally { clearTimeout(t); }
    } catch (_) { /* Fall back to anonymous; never trust browser-only role. */ }
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
    if (limitUntil > Date.now()) { error('Сегодня разговор пока недоступен. Загляни позже.'); return; }
    if (limitUntil) limitUntil = 0;

    const history = conversation.slice(-MAX_CONTEXT);
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
      const data = await response.json();
      if (response.status === 429 && typeof data.reply === 'string' && data.reply.trim()) {
        pending.remove();
        bubble('model', data.reply);
        conversation.push({role:'user',text:question},{role:'model',text:data.reply});
        conversation = conversation.slice(-MAX_SAVED);
        limitUntil = Number(data.retryAt) > Date.now() ? Number(data.retryAt) : Date.now()+3600000;
        save();
        return;
      }
      if (!response.ok || typeof data.reply !== 'string' || !data.reply.trim()) {
        throw new Error('Не получилось отправить сообщение. Попробуй ещё раз.');
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
      error(ex.name === 'AbortError' ? 'Санко долго не отвечает. Попробуй ещё раз.' :
        ex instanceof TypeError ? 'Нет связи с сервером. Проверь соединение.' :
        ex.message);
    } finally {
      clearTimeout(t);
      setBusy(false);
      if (limitUntil > Date.now()) { input.disabled = true; send.disabled = true; }
      else input.focus();
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
    conversation = []; focusDate = ''; limitUntil = 0; warnedPreview = false;
    conversationId = makeId();
    greetingId = chooseGreeting(greetingId);
    if (!PREVIEW) { try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} }
    save(); error(''); input.value=''; render(); resize();
    input.disabled = false; send.disabled = false; input.focus();
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
    if (!PREVIEW) await initVk();
    status.textContent = PREVIEW
      ? 'Макет интерфейса · сервер Санко пока не подключён'
      : 'Тестовый чат Санко · сообщения передаются на отдельный сервер';
    status.classList.toggle('live', !PREVIEW);
    render(); resize(); save();
    if (limitUntil > Date.now()) { input.disabled = true; send.disabled = true; }
    else { input.disabled = false; send.disabled = false; }
  }
  input.disabled = true; send.disabled = true;
  start().catch(() => { render(); resize(); input.disabled = false; send.disabled = false; });
})();