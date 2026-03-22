// API configuration deployed on render
const API_BASE =
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://127.0.0.1:5000"
    : "https://rizchat-g4s4.onrender.com";

let currentUser = null;
let conversations = [];
let activeConvId = null;
let messagesByConv = {};
let userMap = {};
let socket = null;
let typingState = { isTyping: false, timeout: null };
const PAGE_KEY = 'cipher_last_page';
const CONV_KEY = 'cipher_last_conv';
let actionsMenu = null;
let replyState = null;
let groupSelected = new Map();
let typingByConv = {};
let mentionState = null;

const el = (id) => document.getElementById(id);

function getToken(){
  return localStorage.getItem('cipher_token');
}

async function api(path, options = {}){
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  const token = getToken();
  if(token){ headers.Authorization = 'Bearer ' + token; }
  const res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  const data = await res.json().catch(() => ({}));
  if(!res.ok){
    const err = new Error(data.message || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

function showPage(id){
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  el(id).classList.add('active');
  if(id === 'page-chat') initChatPage();
  try{ localStorage.setItem(PAGE_KEY, id); }catch(_){}
}

function openModal(tab='login'){
  el('modal-backdrop').classList.add('open');
  switchTab(tab);
}
function closeModal(){
  el('modal-backdrop').classList.remove('open');
  ['l-err','s-err'].forEach(id => {
    const e = el(id); e.classList.add('hidden'); e.textContent = '';
  });
}
function handleBackdropClick(e){
  if(e.target === el('modal-backdrop')) closeModal();
}
function switchTab(t){
  el('tab-login').classList.toggle('active', t === 'login');
  el('tab-signup').classList.toggle('active', t === 'signup');
  el('form-login').classList.toggle('hidden', t !== 'login');
  el('form-signup').classList.toggle('hidden', t !== 'signup');
}

function openGroupCreateModal(){
  if(!currentUser) return;
  groupSelected = new Map();
  el('g-name').value = '';
  el('g-search').value = '';
  el('g-results').innerHTML = '';
  el('g-selected').innerHTML = '';
  renderGroupSelected();
  el('g-err').classList.add('hidden');
  el('group-create-backdrop').classList.add('open');
}

function closeGroupCreateModal(){
  el('group-create-backdrop').classList.remove('open');
}

function openGroupInfoModal(){
  if(!activeConvId) return;
  const conv = conversations.find(c => c._id === activeConvId);
  if(!conv || !conv.isGroup) return;
  el('gi-title').textContent = conv.name || 'Group';
  el('gi-name').value = conv.name || '';
  el('gi-name').disabled = !isAdmin(conv);
  el('gi-save-btn').classList.toggle('hidden', !isAdmin(conv));
  el('gi-search').value = '';
  el('gi-results').innerHTML = '';
  renderGroupMembers(conv);
  el('group-info-backdrop').classList.add('open');
}

function closeGroupInfoModal(){
  el('group-info-backdrop').classList.remove('open');
}

function handleGroupBackdrop(e, id){
  if(e.target === el(id)){
    if(id === 'group-create-backdrop') closeGroupCreateModal();
    if(id === 'group-info-backdrop') closeGroupInfoModal();
    if(id === 'message-info-backdrop') closeMessageInfo();
  }
}

async function searchGroupUsers(isInfo=false){
  const input = el(isInfo ? 'gi-search' : 'g-search');
  const q = input.value.trim();
  const resEl = el(isInfo ? 'gi-results' : 'g-results');
  if(!q){ resEl.innerHTML = ''; return; }
  try{
    const data = await api('/api/users/search?q=' + encodeURIComponent(q));
    const results = data.users || [];
    hydrateUserMap(results);
    resEl.innerHTML = '';
    results.forEach(u => {
      if(u._id === currentUser._id) return;
      if(isInfo){
        const conv = conversations.find(c => c._id === activeConvId);
        if(conv && conv.participants?.some(p => (p._id || p).toString() === u._id)) return;
      }
      if(!isInfo && groupSelected.has(u._id)) return;
      const row = document.createElement('div');
      row.className = 'g-item';
      row.innerHTML = `
        <div>@${u.username}</div>
        <div class="g-actions"><button class="btn btn-ghost btn-sm">Add</button></div>
      `;
      row.querySelector('button').onclick = () => {
        if(isInfo){
          addGroupMembers([u._id]);
        }else{
          groupSelected.set(u._id, u);
          renderGroupSelected();
          resEl.innerHTML = '';
          input.value = '';
        }
      };
      resEl.appendChild(row);
    });
  }catch(err){
    toast(err.message || 'Search failed', 'err');
  }
}

function renderGroupSelected(){
  const box = el('g-selected');
  box.innerHTML = '';
  if(groupSelected.size === 0){
    box.innerHTML = '<div style="padding:6px 8px;color:var(--ink-4);font-size:0.8rem">No members selected yet.</div>';
    return;
  }
  groupSelected.forEach(u => {
    const pill = document.createElement('div');
    pill.className = 'g-pill';
    pill.innerHTML = `<span>@${u.username}</span><button title="Remove">âœ•</button>`;
    pill.querySelector('button').onclick = () => {
      groupSelected.delete(u._id);
      renderGroupSelected();
    };
    box.appendChild(pill);
  });
}

async function createGroup(){
  const name = el('g-name').value.trim();
  const errEl = el('g-err');
  errEl.classList.add('hidden');
  if(!name){ errEl.textContent = 'Group name required.'; errEl.classList.remove('hidden'); return; }
  const userIds = Array.from(groupSelected.keys());
  if(userIds.length < 1){ errEl.textContent = 'Add at least one member.'; errEl.classList.remove('hidden'); return; }
  el('g-btn').textContent = 'Creating...';
  try{
    const data = await api('/api/conversations/group', { method:'POST', body: JSON.stringify({ name, userIds }) });
    updateConversationInList(data.conversation);
    closeGroupCreateModal();
    showPage('page-chat');
    await openConversation(data.conversation._id);
  }catch(err){
    errEl.textContent = err.message || 'Failed to create group.';
    errEl.classList.remove('hidden');
  }finally{
    el('g-btn').textContent = 'Create Group';
  }
}

function isAdmin(conv){
  return (conv.admins || []).some(a => (a._id || a).toString() === currentUser._id);
}

function renderGroupMembers(conv){
  const box = el('gi-members');
  box.innerHTML = '';
  const adminIds = new Set((conv.admins || []).map(a => (a._id || a).toString()));
  (conv.participants || []).forEach(p => {
    const u = typeof p === 'string' ? (userMap[p] || { _id: p, username: 'user' }) : p;
    const row = document.createElement('div');
    row.className = 'g-item';
    const isMe = u._id === currentUser._id;
    const adminBadge = adminIds.has(u._id) ? ' <span style="color:var(--accent)">Admin</span>' : '';
    row.innerHTML = `
      <div>@${u.username}${isMe ? ' (you)' : ''}${adminBadge}</div>
      <div class="g-actions"></div>
    `;
    const actions = row.querySelector('.g-actions');
    if(isAdmin(conv) && !isMe){
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-ghost btn-sm';
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = () => removeGroupMember(u._id);
      actions.appendChild(removeBtn);
      if(adminIds.has(u._id)){
        const demoteBtn = document.createElement('button');
        demoteBtn.className = 'btn btn-ghost btn-sm';
        demoteBtn.textContent = 'Demote';
        demoteBtn.onclick = () => demoteAdmin(u._id);
        actions.appendChild(demoteBtn);
      }else{
        const promoteBtn = document.createElement('button');
        promoteBtn.className = 'btn btn-ghost btn-sm';
        promoteBtn.textContent = 'Promote';
        promoteBtn.onclick = () => promoteAdmin(u._id);
        actions.appendChild(promoteBtn);
      }
    }
    box.appendChild(row);
  });
  el('gi-add-wrap').classList.toggle('hidden', !isAdmin(conv));
}

async function saveGroupName(){
  const conv = conversations.find(c => c._id === activeConvId);
  if(!conv || !conv.isGroup) return;
  const name = el('gi-name').value.trim();
  if(!name) return toast('Group name required', 'err');
  try{
    const data = await api('/api/conversations/' + conv._id + '/name', { method:'PATCH', body: JSON.stringify({ name }) });
    updateConversationInList(data.conversation);
    renderGroupMembers(data.conversation);
  }catch(err){
    toast(err.message || 'Failed to update group', 'err');
  }
}

async function addGroupMembers(userIds){
  const conv = conversations.find(c => c._id === activeConvId);
  if(!conv || !conv.isGroup) return;
  try{
    const data = await api('/api/conversations/' + conv._id + '/participants', { method:'POST', body: JSON.stringify({ userIds }) });
    updateConversationInList(data.conversation);
    renderGroupMembers(data.conversation);
    el('gi-results').innerHTML = '';
    el('gi-search').value = '';
  }catch(err){
    toast(err.message || 'Failed to add members', 'err');
  }
}

async function removeGroupMember(userId){
  const conv = conversations.find(c => c._id === activeConvId);
  if(!conv || !conv.isGroup) return;
  if(!confirm('Remove this member?')) return;
  try{
    const data = await api('/api/conversations/' + conv._id + '/participants/' + userId, { method:'DELETE' });
    updateConversationInList(data.conversation);
    renderGroupMembers(data.conversation);
  }catch(err){
    toast(err.message || 'Failed to remove member', 'err');
  }
}

async function promoteAdmin(userId){
  const conv = conversations.find(c => c._id === activeConvId);
  if(!conv || !conv.isGroup) return;
  try{
    const data = await api('/api/conversations/' + conv._id + '/admins', { method:'POST', body: JSON.stringify({ userId }) });
    updateConversationInList(data.conversation);
    renderGroupMembers(data.conversation);
  }catch(err){
    toast(err.message || 'Failed to promote', 'err');
  }
}

async function demoteAdmin(userId){
  const conv = conversations.find(c => c._id === activeConvId);
  if(!conv || !conv.isGroup) return;
  try{
    const data = await api('/api/conversations/' + conv._id + '/admins/' + userId, { method:'DELETE' });
    updateConversationInList(data.conversation);
    renderGroupMembers(data.conversation);
  }catch(err){
    toast(err.message || 'Failed to demote', 'err');
  }
}

async function leaveGroup(){
  const conv = conversations.find(c => c._id === activeConvId);
  if(!conv || !conv.isGroup) return;
  if(!confirm('Leave this group?')) return;
  try{
    await api('/api/conversations/' + conv._id + '/leave', { method:'POST' });
    conversations = conversations.filter(c => c._id !== conv._id);
    closeGroupInfoModal();
    showConversationList();
    renderConvList();
  }catch(err){
    toast(err.message || 'Failed to leave group', 'err');
  }
}

function closeMessageInfo(){
  el('message-info-backdrop').classList.remove('open');
}

function openMessageInfo(msg){
  const conv = conversations.find(c => c._id === activeConvId);
  if(!conv || !conv.isGroup) return;
  const participants = (conv.participants || []).map(p => typeof p === 'string'
    ? (userMap[p] || { _id: p, username: 'unknown' })
    : p
  );
  const readIds = new Set((msg.readBy || []).map(r => (r.userId || r).toString()));
  const seen = participants.filter(u => u._id !== msg.sender && readIds.has(u._id));
  const unseen = participants.filter(u => u._id !== msg.sender && !readIds.has(u._id));

  const seenEl = el('mi-seen');
  const unseenEl = el('mi-unseen');
  seenEl.innerHTML = '';
  unseenEl.innerHTML = '';

  if(!seen.length){
    seenEl.innerHTML = '<div style="padding:6px 8px;color:var(--ink-4);font-size:0.8rem">No one yet.</div>';
  }else{
    seen.forEach(u => {
      const row = document.createElement('div');
      row.className = 'g-item';
      row.textContent = '@' + (u.username || 'unknown');
      seenEl.appendChild(row);
    });
  }

  if(!unseen.length){
    unseenEl.innerHTML = '<div style="padding:6px 8px;color:var(--ink-4);font-size:0.8rem">Everyone has seen it.</div>';
  }else{
    unseen.forEach(u => {
      const row = document.createElement('div');
      row.className = 'g-item';
      row.textContent = '@' + (u.username || 'unknown');
      unseenEl.appendChild(row);
    });
  }

  el('message-info-backdrop').classList.add('open');
}

document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){
    closeModal();
    closeGroupCreateModal();
    closeGroupInfoModal();
    closeMessageInfo();
  }
});

async function submitLogin(){
  const email = el('l-email').value.trim();
  const pass  = el('l-pass').value;
  const errEl = el('l-err');
  const btn   = el('l-btn');

  errEl.classList.add('hidden');
  if(!email || !pass){ errEl.textContent = 'Email and password required.'; errEl.classList.remove('hidden'); return; }

  btn.textContent = 'Signing in...';
  try{
    const data = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ email, password: pass }) });
    localStorage.setItem('cipher_token', data.token);
    localStorage.setItem('cipher_user', JSON.stringify(data.user));
    currentUser = data.user;
    hydrateUserMap([data.user]);
    closeModal();
    toast('Welcome back, @' + data.user.username + '!');
    await bootstrapApp();
  }catch(err){
    errEl.textContent = err.message || 'Login failed.';
    errEl.classList.remove('hidden');
  }finally{
    btn.textContent = 'Sign In';
  }
}

async function submitSignup(){
  const uname = el('s-uname').value.trim();
  const email = el('s-email').value.trim();
  const pass  = el('s-pass').value;
  const errEl = el('s-err');
  const btn   = el('s-btn');

  errEl.classList.add('hidden');
  if(!uname || uname.length < 3){ errEl.textContent = 'Username must be at least 3 characters.'; errEl.classList.remove('hidden'); return; }
  if(!email.includes('@')){ errEl.textContent = 'Please enter a valid email.'; errEl.classList.remove('hidden'); return; }
  if(pass.length < 6){ errEl.textContent = 'Password must be at least 6 characters.'; errEl.classList.remove('hidden'); return; }

  btn.textContent = 'Creating...';
  try{
    const data = await api('/api/auth/signup', { method:'POST', body: JSON.stringify({ username: uname, email, password: pass }) });
    localStorage.setItem('cipher_token', data.token);
    localStorage.setItem('cipher_user', JSON.stringify(data.user));
    currentUser = data.user;
    hydrateUserMap([data.user]);
    closeModal();
    toast('Welcome to Cipher, @' + uname + '!');
    await bootstrapApp();
  }catch(err){
    errEl.textContent = err.message || 'Signup failed.';
    errEl.classList.remove('hidden');
  }finally{
    btn.textContent = 'Create Account';
  }
}

function logout(){
  localStorage.removeItem('cipher_token');
  localStorage.removeItem('cipher_user');
  if(socket){ socket.disconnect(); socket = null; }
  currentUser = null;
  activeConvId = null;
  conversations = [];
  messagesByConv = {};
  showPage('page-landing');
  try{ localStorage.removeItem(PAGE_KEY); }catch(_){}
  try{ localStorage.removeItem(CONV_KEY); }catch(_){}
  updateNavForAuth(false);
  toast('Signed out.');
}

function initUserUI(){
  if(!currentUser) return;
  const init = initials(currentUser.username);
  el('s-avatar').textContent = init;
  el('s-username').textContent = '@' + currentUser.username;
  el('c-my-avatar').textContent = init;
  el('c-my-name').textContent = '@' + currentUser.username;
  updateNavForAuth(true);
}

async function bootstrapApp(){
  initUserUI();
  const last = localStorage.getItem(PAGE_KEY);
  await loadConversations();
  connectSocket();
  const target = last || 'page-search';
  showPage(target);
  if(target === 'page-chat'){
    const lastConv = localStorage.getItem(CONV_KEY);
    if(lastConv){ await openConversation(lastConv); }
  }
  requestNotificationPermission();
}

async function loadMe(){
  const token = getToken();
  if(!token) return false;
  try{
    const data = await api('/api/users/me');
    currentUser = data.user;
    hydrateUserMap([data.user]);
    await bootstrapApp();
    return true;
  }catch(err){
    if(err.status === 401){
      localStorage.removeItem('cipher_token');
      localStorage.removeItem('cipher_user');
      return false;
    }
    const cached = localStorage.getItem('cipher_user');
    if(cached){
      try{
        currentUser = JSON.parse(cached);
        hydrateUserMap([currentUser]);
        await bootstrapApp();
        return true;
      }catch(_){ /* ignore */ }
    }
    return false;
  }
}

function hydrateUserMap(users){
  users.forEach(u => { userMap[u._id] = u; });
}

function updateNavForAuth(isAuthed){
  el('nav-login').classList.toggle('hidden', isAuthed);
  el('nav-signup').classList.toggle('hidden', isAuthed);
  el('nav-dashboard').classList.toggle('hidden', !isAuthed);
  el('hero-guest-cta').classList.toggle('hidden', isAuthed);
  el('hero-authed-cta').classList.toggle('hidden', !isAuthed);
  el('landing-signout').classList.toggle('hidden', !isAuthed);
}

// Search page
el('s-input').addEventListener('input', debounce(doSearch, 300));
el('s-input').addEventListener('keydown', e => { if(e.key === 'Enter') doSearch(); });

async function doSearch(){
  const q = el('s-input').value.trim().toLowerCase();
  const resEl  = el('s-results');
  const lblEl  = el('s-label');
  const empEl  = el('s-empty');

  if(!q){ resEl.innerHTML = ''; lblEl.classList.add('hidden'); empEl.classList.remove('hidden'); return; }

  try{
    const data = await api('/api/users/search?q=' + encodeURIComponent(q));
    const results = data.users || [];
    hydrateUserMap(results);

    empEl.classList.add('hidden');
    resEl.innerHTML = '';

    if(!results.length){
      empEl.querySelector('.s-empty-text').textContent = 'No users matching "' + q + '"';
      empEl.classList.remove('hidden');
      lblEl.classList.add('hidden');
      return;
    }

    lblEl.textContent = results.length + ' result' + (results.length !== 1 ? 's' : '');
    lblEl.classList.remove('hidden');

    results.forEach(u => {
      if(u._id === currentUser._id) return;
      const card = document.createElement('div');
      card.className = 'user-card';
      card.innerHTML = `
        <div class="avatar avatar-lg">${initials(u.username)}</div>
        <div class="uc-info">
          <div class="uc-name">@${u.username}</div>
          <div class="uc-email">${u.email}</div>
        </div>
        <div class="uc-arrow">Chat -&gt;</div>
      `;
      card.onclick = async () => {
        showPage('page-chat');
        await openOrCreateConv(u._id);
      };
      resEl.appendChild(card);
    });
  }catch(err){
    toast(err.message || 'Search failed', 'err');
  }
}

// Chat page
function initChatPage(){
  if(!currentUser){ showPage('page-landing'); return; }
  if(!activeConvId) setChatView('list');
  renderConvList();
}

async function loadConversations(){
  try{
    const data = await api('/api/conversations');
    conversations = data.conversations || [];
    hydrateUserMapFromConversations(conversations);
    renderConvList();
  }catch(err){
    toast(err.message || 'Failed to load conversations', 'err');
  }
}

function hydrateUserMapFromConversations(list){
  list.forEach(c => {
    (c.participants || []).forEach(p => hydrateUserMap([p]));
  });
}

function getOtherParticipant(conv){
  return (conv.participants || []).find(p => p._id !== currentUser._id);
}

function isGroupConv(conv){
  return !!conv && !!conv.isGroup;
}

function getConvTitle(conv){
  if(isGroupConv(conv)) return conv.name || 'Group';
  const other = getOtherParticipant(conv);
  return other ? '@' + other.username : 'Chat';
}

function getConvAvatarText(conv){
  if(isGroupConv(conv)) return initials(conv.name || 'GR');
  const other = getOtherParticipant(conv);
  return other ? initials(other.username) : '?';
}

function getUsernameFor(conv, userId){
  if(!userId) return 'Unknown';
  const fromMap = userMap[userId];
  if(fromMap && fromMap.username) return fromMap.username;
  if(conv && Array.isArray(conv.participants)){
    const match = conv.participants.find(p => (p._id || p).toString() === userId.toString());
    if(match && match.username) return match.username;
  }
  return 'Unknown';
}

function renderConvList(){
  const list = el('c-conv-list');
  list.innerHTML = '';

  if(!conversations.length){
    list.innerHTML = '<div style="padding:20px 16px;font-size:0.8rem;color:var(--ink-4)">No conversations yet.</div>';
    return;
  }

  conversations.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  conversations.forEach(conv => {
    const last = conv.lastMessage;
    const preview = last
      ? (last.type === 'file' ? ('File: ' + (last.file?.name || 'attachment')) : (last.text || ''))
      : 'Start a conversation';
    const isActive = activeConvId === conv._id;
    const unread = conv.unreadCount || 0;

    const elConv = document.createElement('div');
    elConv.className = 'c-conv' + (isActive ? ' active' : '');
    elConv.id = 'conv-' + conv._id;
    const title = getConvTitle(conv);
    const avatarText = getConvAvatarText(conv);
    const displayPreview = isGroupConv(conv) && last && last.sender
      ? ((userMap[last.sender]?.username ? (userMap[last.sender].username + ': ') : '') + preview)
      : preview;
    const memberCount = isGroupConv(conv) ? (conv.participants?.length || 0) : 0;
    elConv.innerHTML = `
      <div class="avatar" style="position:relative">
        ${avatarText}
        ${(!isGroupConv(conv) && getOtherParticipant(conv)?.online) ? '<span style="position:absolute;bottom:0;right:0;width:9px;height:9px;border-radius:50%;background:var(--green);border:2px solid var(--cream)"></span>' : ''}
      </div>
      <div class="c-conv-info">
        <div class="c-conv-name">${esc(title)}${isGroupConv(conv) ? ` <span style="color:var(--ink-4);font-weight:400">(${memberCount})</span>` : ''}</div>
        <div class="c-conv-preview">${esc(displayPreview)}</div>
      </div>
      <div class="c-conv-meta">
        <div class="c-conv-time">${last ? fmtTime(last.createdAt) : ''}</div>
        ${unread ? `<div class="c-conv-badge">${unread}</div>` : ''}
      </div>
    `;
    elConv.onclick = async () => {
      await openConversation(conv._id);
    };
    list.appendChild(elConv);
  });
}

async function openOrCreateConv(userId){
  try{
    const data = await api('/api/conversations', { method:'POST', body: JSON.stringify({ userId }) });
    const conv = data.conversation;
    const existing = conversations.find(c => c._id === conv._id);
    if(!existing){ conversations.push(conv); }
    await openConversation(conv._id);
  }catch(err){
    toast(err.message || 'Failed to open conversation', 'err');
  }
}

async function openConversation(convId){
  activeConvId = convId;
  clearReply();
  hideMentionList();
  try{ localStorage.setItem(CONV_KEY, convId); }catch(_){}
  const conv = conversations.find(c => c._id === convId);
  if(!conv) return;

  document.querySelectorAll('.c-conv').forEach(elm => elm.classList.remove('active'));
  const convEl = el('conv-' + convId);
  if(convEl) convEl.classList.add('active');

  if(isGroupConv(conv)){
    el('c-head-avatar').textContent = initials(conv.name || 'GR');
    el('c-head-name').textContent = conv.name || 'Group';
    const count = conv.participants?.length || 0;
    el('c-head-status').className = 'c-head-status';
    el('c-head-status').textContent = count + ' member' + (count !== 1 ? 's' : '');
    el('c-group-btn').classList.remove('hidden');
  }else{
    const other = getOtherParticipant(conv);
    if(other){
      el('c-head-avatar').textContent = initials(other.username);
      el('c-head-name').textContent = '@' + other.username;
      updateHeaderStatus(other);
    }
    el('c-group-btn').classList.add('hidden');
  }

  el('c-empty').style.display = 'none';
  el('c-panel').classList.add('open');
  setChatView('chat');

  await loadMessages(convId);
  joinConversationRoom(convId);
  markConversationRead(convId);
  el('c-textarea').focus();
}

function updateHeaderStatus(user){
  const status = el('c-head-status');
  if(user.online){
    status.className = 'c-head-status online';
    status.innerHTML = '<span class="online-dot"></span> Online';
  }else{
    status.className = 'c-head-status';
    status.innerHTML = '<span style="color:var(--ink-4)">Last seen ' + fmtLastSeen(user.lastSeen) + '</span>';
  }
}

async function loadMessages(convId){
  try{
    const data = await api('/api/messages/' + convId);
    messagesByConv[convId] = data.messages || [];
    renderMessages(convId);
  }catch(err){
    toast(err.message || 'Failed to load messages', 'err');
  }
}

function renderMessages(convId){
  const area = el('c-msgs');
  area.innerHTML = '';
  const msgs = messagesByConv[convId] || [];
  const conv = conversations.find(c => c._id === convId);
  const isGroup = !!conv && conv.isGroup;

  if(!msgs.length){
    area.innerHTML = '<div style="text-align:center;padding:40px;font-size:0.82rem;color:var(--ink-4)">No messages yet. Say hello!</div>';
    return;
  }

  let lastDay = '';
  const lastSentIndex = findLastSentIndex(msgs);
  msgs.forEach((m, idx) => {
    const day = fmtDay(m.createdAt);
    if(day !== lastDay){
      lastDay = day;
      const div = document.createElement('div');
      div.className = 'msg-day';
      div.innerHTML = '<span class="msg-day-lbl">' + day + '</span>';
      area.appendChild(div);
    }
    const isSent = m.sender === currentUser._id;
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (isSent ? 'sent' : 'recv');
    wrap.dataset.msgId = m._id;
    const fileUrl = m.file?.url ? (m.file.url.startsWith('/') ? (API_BASE + m.file.url) : m.file.url) : '#';
    const senderName = '@' + getUsernameFor(conv, m.sender);
    const senderLabel = (!isSent && isGroup) ? '<div class="msg-sender">' + esc(senderName) + '</div>' : '';
    const replyLabel = m.replyTo ? renderReplyPreview(m.replyTo, conv, isGroup) : '';
    const content = m.type === 'file'
      ? `<a href="${fileUrl}" target="_blank" rel="noopener">${esc(m.file?.name || 'File')}</a>`
      : (m.deleted ? 'Message deleted' : esc(m.text || ''));
    const showStatus = isSent && idx === lastSentIndex;
    const statusLabel = showStatus ? statusText(m.status) : '';
    const timeLabel = fmtTime(m.createdAt) + (m.editedAt ? ' • edited' : '');
    const actionsBtn = isSent
      ? `<button class="msg-actions-trigger" title="Message options" data-msg-id="${m._id}">⋯</button>`
      : '';
    const replyBtn = `<button class="msg-reply-trigger" title="Reply" data-msg-id="${m._id}">↩</button>`;
    wrap.innerHTML = `
      <div class="msg-bubble">${senderLabel}${replyLabel}${content}</div>
      ${replyBtn}
      ${actionsBtn}
      <div class="msg-time">
        ${timeLabel}
        ${showStatus ? `<span class="msg-status ${statusClass(m.status)}">${statusLabel}</span>` : ''}
      </div>
    `;
    const rb = wrap.querySelector('.msg-reply-trigger');
    if(rb){
      rb.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        setReply(m);
      };
    }
    area.appendChild(wrap);
  });

  renderTypingIndicator(convId);
  area.scrollTop = area.scrollHeight;
}

function renderTypingIndicator(convId){
  const area = el('c-msgs');
  const conv = conversations.find(c => c._id === convId);
  if(!conv) return;
  if(conv.isGroup){
    const set = typingByConv[convId] || new Set();
    const ids = Array.from(set);
    if(!ids.length) return;
    const names = ids.map(id => '@' + getUsernameFor(conv, id));
    const label = names.length === 1
      ? (names[0] + ' is typing...')
      : (names.join(', ') + ' are typing...');
    const wrap = document.createElement('div');
    wrap.className = 'typing-wrap';
    wrap.innerHTML = `
      <div>
        <div class="typing-label">${esc(label)}</div>
        <div class="typing-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>
      </div>
    `;
    area.appendChild(wrap);
    return;
  }

  const other = getOtherParticipant(conv);
  if(!other || !other.isTyping) return;

  const wrap = document.createElement('div');
  wrap.className = 'typing-wrap';
  wrap.innerHTML = '<div class="typing-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
  area.appendChild(wrap);
}

function renderReplyPreview(reply, conv, isGroup){
  const senderName = '@' + getUsernameFor(conv, reply.sender);
  const body = reply.type === 'file'
    ? ('File: ' + (reply.file?.name || 'attachment'))
    : (reply.text || 'Message');
  const msgId = reply.messageId ? reply.messageId.toString() : '';
  const namePart = isGroup ? `<strong>${esc(senderName)}</strong> ` : '';
  const cls = isGroup ? 'msg-reply' : 'msg-reply dm';
  return `<div class="${cls}" data-reply-id="${msgId}">${namePart}${esc(body)}</div>`;
}

function setReply(msg){
  if(!msg) return;
  const reply = {
    messageId: msg._id,
    sender: msg.sender,
    text: msg.deleted ? 'Message deleted' : (msg.text || ''),
    type: msg.type || 'text',
    file: msg.file || null
  };
  replyState = reply;
  const label = reply.sender === currentUser._id ? 'Replying to yourself' : 'Replying to @' + (userMap[reply.sender]?.username || 'user');
  el('reply-label').textContent = label;
  const text = reply.type === 'file'
    ? ('File: ' + (reply.file?.name || 'attachment'))
    : (reply.text || 'Message');
  el('reply-text').textContent = text;
  el('reply-bar').classList.remove('hidden');
  el('c-textarea').focus();
}

function clearReply(){
  replyState = null;
  el('reply-bar').classList.add('hidden');
}

function hideMentionList(){
  mentionState = null;
  el('mention-list').classList.add('hidden');
  el('mention-list').innerHTML = '';
}

function updateMentionList(){
  const conv = conversations.find(c => c._id === activeConvId);
  if(!conv || !conv.isGroup) return hideMentionList();
  const text = textarea.value;
  const cursor = textarea.selectionStart || 0;
  const before = text.slice(0, cursor);
  const atIndex = before.lastIndexOf('@');
  if(atIndex < 0) return hideMentionList();
  const prevChar = atIndex > 0 ? before[atIndex - 1] : ' ';
  if(prevChar && !/\s/.test(prevChar)) return hideMentionList();
  const query = before.slice(atIndex + 1);
  if(/\s/.test(query)) return hideMentionList();
  const q = query.toLowerCase();
  const participants = (conv.participants || []).map(p => typeof p === 'string'
    ? (userMap[p] || { _id: p, username: 'unknown' })
    : p
  ).filter(u => u._id !== currentUser._id);
  const matches = participants.filter(u => (u.username || '').toLowerCase().includes(q));
  if(!matches.length) return hideMentionList();
  mentionState = { start: atIndex, end: cursor, matches };
  const list = el('mention-list');
  list.innerHTML = '';
  matches.forEach(u => {
    const item = document.createElement('div');
    item.className = 'mention-item';
    item.textContent = '@' + (u.username || 'unknown');
    item.onmousedown = (e) => {
      e.preventDefault();
      insertMention(u.username || 'unknown');
    };
    list.appendChild(item);
  });
  list.classList.remove('hidden');
}

function insertMention(username){
  if(!mentionState) return;
  const text = textarea.value;
  const before = text.slice(0, mentionState.start);
  const after = text.slice(mentionState.end);
  const insert = '@' + username + ' ';
  const next = before + insert + after;
  textarea.value = next;
  const newPos = before.length + insert.length;
  textarea.setSelectionRange(newPos, newPos);
  textarea.focus();
  hideMentionList();
}

const textarea = el('c-textarea');
const sendBtn  = el('c-send');
const fileInput = el('c-file');
const msgsArea = el('c-msgs');

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if(!file || !activeConvId) return;
  try{
    const uploaded = await uploadFile(file);
    await sendFileMessage(uploaded);
  }catch(err){
    toast(err.message || 'File upload failed', 'err');
  }finally{
    fileInput.value = '';
  }
});

msgsArea.addEventListener('click', (e) => {
  const actionBtn = e.target.closest('.msg-actions-trigger');
  if(actionBtn){
    e.preventDefault();
    e.stopPropagation();
    const msgId = actionBtn.dataset.msgId;
    const msg = findMessageById(activeConvId, msgId);
    if(msg){
      const rect = actionBtn.getBoundingClientRect();
      showMessageActions(msg, rect.right, rect.bottom);
    }
    return;
  }
  const replyBtn = e.target.closest('.msg-reply-trigger');
  if(replyBtn){
    e.preventDefault();
    e.stopPropagation();
    const msgId = replyBtn.dataset.msgId;
    const msg = findMessageById(activeConvId, msgId);
    if(msg) setReply(msg);
    return;
  }
  const replyPreview = e.target.closest('.msg-reply');
  if(replyPreview){
    const targetId = replyPreview.dataset.replyId;
    if(targetId){
      const targetEl = msgsArea.querySelector(`.msg[data-msg-id="${targetId}"]`);
      if(targetEl){
        targetEl.classList.add('msg-highlight');
        targetEl.scrollIntoView({ behavior:'smooth', block:'center' });
        setTimeout(() => targetEl.classList.remove('msg-highlight'), 1200);
      }
    }
  }
});

let touchStartX = 0;
let touchStartY = 0;
let touchStartMsgId = null;
msgsArea.addEventListener('touchstart', (e) => {
  const msgEl = e.target.closest('.msg');
  if(!msgEl) return;
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  touchStartMsgId = msgEl.dataset.msgId;
});
msgsArea.addEventListener('touchend', (e) => {
  if(!touchStartMsgId) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  if(dx > 60 && Math.abs(dy) < 30){
    const msg = findMessageById(activeConvId, touchStartMsgId);
    if(msg) setReply(msg);
  }
  touchStartMsgId = null;
});

textarea.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 130) + 'px';
  sendBtn.disabled = !textarea.value.trim();
  emitTyping(true);
  updateMentionList();
});
textarea.addEventListener('keydown', e => {
  if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendMsg(); }
});
textarea.addEventListener('blur', () => setTimeout(hideMentionList, 120));

async function sendMsg(){
  const text = textarea.value.trim();
  if(!text || !activeConvId || !currentUser) return;

  const clientId = 'c' + Date.now() + Math.random().toString(36).slice(2,6);
  const replyTo = replyState ? Object.assign({}, replyState) : null;
  const msg = {
    _id: clientId,
    sender: currentUser._id,
    text,
    type: 'text',
    replyTo,
    readBy: [],
    status: 'sent',
    createdAt: new Date().toISOString(),
    clientId
  };

  messagesByConv[activeConvId] = messagesByConv[activeConvId] || [];
  messagesByConv[activeConvId].push(msg);

  textarea.value = '';
  textarea.style.height = 'auto';
  sendBtn.disabled = true;
  hideMentionList();
  if(replyState) clearReply();

  renderMessages(activeConvId);
  updateConversationPreview(activeConvId, msg);

  if(socket && socket.connected){
    socket.emit('message:send', { conversationId: activeConvId, text, type: 'text', clientId, replyTo });
  }else{
    try{
      await api('/api/messages', { method:'POST', body: JSON.stringify({ conversationId: activeConvId, text, type: 'text', replyTo }) });
    }catch(err){
      toast(err.message || 'Message failed to send', 'err');
    }
  }
}

async function sendFileMessage(fileInfo){
  const clientId = 'c' + Date.now() + Math.random().toString(36).slice(2,6);
  const replyTo = replyState ? Object.assign({}, replyState) : null;
  const msg = {
    _id: clientId,
    sender: currentUser._id,
    type: 'file',
    file: fileInfo,
    replyTo,
    readBy: [],
    status: 'sent',
    createdAt: new Date().toISOString(),
    clientId
  };

  messagesByConv[activeConvId] = messagesByConv[activeConvId] || [];
  messagesByConv[activeConvId].push(msg);
  renderMessages(activeConvId);
  updateConversationPreview(activeConvId, msg);
  hideMentionList();
  if(replyState) clearReply();

  if(socket && socket.connected){
    socket.emit('message:send', { conversationId: activeConvId, type: 'file', file: fileInfo, clientId, replyTo });
  }else{
    await api('/api/messages', { method:'POST', body: JSON.stringify({ conversationId: activeConvId, type: 'file', file: fileInfo, replyTo }) });
  }
}

function updateConversationPreview(convId, msg){
  const conv = conversations.find(c => c._id === convId);
  if(!conv) return;
  const previewText = getMessagePreview(msg);
  conv.lastMessage = Object.assign({}, msg, { text: previewText, createdAt: msg.createdAt || new Date().toISOString() });
  conv.updatedAt = conv.lastMessage.createdAt;
  renderConvList();
}

function updateConversationInList(updated){
  if(!updated) return;
  const idx = conversations.findIndex(c => c._id === updated._id);
  if(idx >= 0) conversations[idx] = updated;
  else conversations.push(updated);
  hydrateUserMapFromConversations([updated]);
  renderConvList();
  if(activeConvId === updated._id){
    openConversation(updated._id);
  }
}

function filterConvs(){
  const q = el('c-filter').value.toLowerCase();
  document.querySelectorAll('.c-conv').forEach(elm => {
    const name = elm.querySelector('.c-conv-name')?.textContent.toLowerCase() || '';
    elm.style.display = name.includes(q) ? '' : 'none';
  });
}

// Socket
function connectSocket(){
  if(socket || !getToken()) return;
  ensureSocketIO().then(() => {
    if(socket) return;
    socket = io(API_BASE, { auth: { token: getToken() } });

    socket.on('connect', () => {
      if(activeConvId){ joinConversationRoom(activeConvId); }
    });

    socket.on('presence:update', (payload) => {
    const user = userMap[payload.userId] || { _id: payload.userId };
    user.online = payload.online;
    user.lastSeen = payload.lastSeen;
    userMap[payload.userId] = user;

    const conv = conversations.find(c => (c.participants || []).some(p => p._id === payload.userId));
    if(conv){
      const idx = conv.participants.findIndex(p => p._id === payload.userId);
      if(idx >= 0){
        conv.participants[idx].online = payload.online;
        conv.participants[idx].lastSeen = payload.lastSeen;
      }
    }
    if(activeConvId){
      const active = conversations.find(c => c._id === activeConvId);
      if(active && !active.isGroup){
        const other = getOtherParticipant(active);
        if(other && other._id === payload.userId){ updateHeaderStatus(other); }
      }
    }
    renderConvList();
  });

  socket.on('message:new', (message) => {
    const convId = message.conversationId;
    let conv = conversations.find(c => c._id === convId);
    if(!conv){
      loadConversations();
      return;
    }
    messagesByConv[convId] = messagesByConv[convId] || [];

    // Replace optimistic message by clientId if present
    if(message.clientId){
      const idx = messagesByConv[convId].findIndex(m => m.clientId === message.clientId);
      if(idx >= 0){ messagesByConv[convId][idx] = message; }
      else { messagesByConv[convId].push(message); }
    }else{
      messagesByConv[convId].push(message);
    }

    updateConversationPreview(convId, message);

    if(activeConvId === convId){
      renderMessages(convId);
      if(message.sender !== currentUser._id){
        markConversationRead(convId);
        maybeNotify(message, conv);
      }
    }else{
      conv.unreadCount = (conv.unreadCount || 0) + 1;
      renderConvList();
      maybeNotify(message, conv);
    }
  });

  socket.on('message:status', ({ messageId, status, conversationId }) => {
    const msgs = messagesByConv[conversationId] || [];
    const msg = msgs.find(m => m._id === messageId);
    if(msg){ msg.status = status; }
    if(activeConvId === conversationId){ renderMessages(conversationId); }
  });

  socket.on('message:readers', ({ messageId, conversationId, readBy, status }) => {
    const msgs = messagesByConv[conversationId] || [];
    const msg = msgs.find(m => m._id === messageId);
    if(msg){
      msg.readBy = readBy || msg.readBy || [];
      if(status) msg.status = status;
    }
    if(activeConvId === conversationId){ renderMessages(conversationId); }
  });

  socket.on('typing:update', ({ conversationId, userId, isTyping }) => {
    const conv = conversations.find(c => c._id === conversationId);
    if(!conv) return;
    if(conv.isGroup){
      if(userId === currentUser._id) return;
      if(!typingByConv[conversationId]) typingByConv[conversationId] = new Set();
      if(isTyping) typingByConv[conversationId].add(userId);
      else typingByConv[conversationId].delete(userId);
      if(activeConvId === conversationId){ renderMessages(conversationId); }
      return;
    }
    const other = getOtherParticipant(conv);
    if(!other || other._id !== userId) return;
    other.isTyping = isTyping;
    if(activeConvId === conversationId){ renderMessages(conversationId); }
  });

  socket.on('message:updated', (payload) => {
    const { conversationId, messageId, text, editedAt } = payload;
    const msg = findMessageById(conversationId, messageId);
    if(msg){
      msg.text = text;
      msg.editedAt = editedAt;
      msg.deleted = false;
      msg.type = 'text';
      renderMessages(conversationId);
      updateConversationPreview(conversationId, msg);
    }
  });

    socket.on('message:deleted', (payload) => {
    const { conversationId, messageId } = payload;
    const msg = findMessageById(conversationId, messageId);
    if(msg){
      msg.deleted = true;
      msg.text = '';
      msg.file = null;
      msg.type = 'text';
      renderMessages(conversationId);
      updateConversationPreview(conversationId, msg);
    }
    });
  });
}

function ensureSocketIO(){
  if(window.io) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-socketio]');
    if(existing){
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Socket.IO failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.src = API_BASE + '/socket.io/socket.io.js';
    s.async = true;
    s.dataset.socketio = 'true';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Socket.IO failed to load'));
    document.head.appendChild(s);
  });
}

function joinConversationRoom(convId){
  if(socket && socket.connected){ socket.emit('conversation:join', { conversationId: convId }); }
}

function setChatView(mode){
  const page = el('page-chat');
  page.classList.remove('chat-view-list','chat-view-chat');
  page.classList.add(mode === 'chat' ? 'chat-view-chat' : 'chat-view-list');
}

function showConversationList(){
  activeConvId = null;
  try{ localStorage.removeItem(CONV_KEY); }catch(_){}
  setChatView('list');
}

function markConversationRead(convId){
  if(socket && socket.connected){ socket.emit('message:read', { conversationId: convId }); }
  const conv = conversations.find(c => c._id === convId);
  if(conv){ conv.unreadCount = 0; }
  renderConvList();
}

function emitTyping(isTyping){
  if(!activeConvId || !socket || !socket.connected) return;
  if(isTyping && !typingState.isTyping){
    socket.emit('message:typing', { conversationId: activeConvId, isTyping: true });
    typingState.isTyping = true;
  }
  clearTimeout(typingState.timeout);
  typingState.timeout = setTimeout(() => {
    if(typingState.isTyping){
      socket.emit('message:typing', { conversationId: activeConvId, isTyping: false });
      typingState.isTyping = false;
    }
  }, 900);
}

// Helpers
function initials(name){ return (name || '').slice(0,2).toUpperCase(); }

function fmtTime(ts){
  const d = new Date(ts), now = new Date();
  if(d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  return d.toLocaleDateString([], { month:'short', day:'numeric' });
}

function fmtDay(ts){
  const d = new Date(ts), now = new Date();
  if(d.toDateString() === now.toDateString()) return 'Today';
  if(new Date(now - 86400000).toDateString() === d.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday:'long', month:'long', day:'numeric' });
}

function fmtLastSeen(ts){
  if(!ts) return 'recently';
  const d = new Date(ts);
  return d.toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function esc(str){
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function debounce(fn, delay){
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function toast(msg, type='ok'){
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const e = document.createElement('div');
  e.className = 'toast toast-' + type;
  e.textContent = msg;
  document.body.appendChild(e);
  setTimeout(() => e.remove(), 3500);
}

function statusClass(status){
  if(status === 'read') return 'msg-read';
  if(status === 'delivered') return 'msg-delivered';
  return 'msg-sent';
}

function statusText(status){
  if(status === 'read') return 'Seen';
  if(status === 'delivered') return 'Delivered';
  return 'Sent';
}

function findLastSentIndex(msgs){
  for(let i = msgs.length - 1; i >= 0; i--){
    if(msgs[i].sender === currentUser._id) return i;
  }
  return -1;
}

function getMessagePreview(msg){
  if(msg.deleted) return 'Message deleted';
  if(msg.type === 'file') return 'File: ' + (msg.file?.name || 'attachment');
  return msg.text || '';
}

function findMessageById(convId, messageId){
  const list = messagesByConv[convId] || [];
  return list.find(m => m._id === messageId);
}

function showMessageActions(msg, x, y){
  if(msg.sender !== currentUser._id) return;
  if(!actionsMenu){
    actionsMenu = document.createElement('div');
    actionsMenu.className = 'msg-actions';
    actionsMenu.innerHTML = `
      <button id="msg-info">Info</button>
      <button id="msg-edit">Edit</button>
      <button id="msg-delete" class="danger">Delete</button>
    `;
    document.body.appendChild(actionsMenu);
    document.addEventListener('click', (e) => {
      if(!actionsMenu.contains(e.target)) hideMessageActions();
    });
  }
  actionsMenu.style.display = 'block';
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = actionsMenu.offsetWidth;
  const h = actionsMenu.offsetHeight;
  let left = x;
  let top = y;
  if(left + w + pad > vw) left = vw - w - pad;
  if(top + h + pad > vh) top = vh - h - pad;
  if(left < pad) left = pad;
  if(top < pad) top = pad;
  actionsMenu.style.left = left + 'px';
  actionsMenu.style.top = top + 'px';

  const editBtn = actionsMenu.querySelector('#msg-edit');
  const delBtn  = actionsMenu.querySelector('#msg-delete');
  const infoBtn = actionsMenu.querySelector('#msg-info');

  const conv = conversations.find(c => c._id === activeConvId);
  const showInfo = !!conv && conv.isGroup;
  infoBtn.style.display = showInfo ? 'block' : 'none';
  infoBtn.onclick = () => {
    hideMessageActions();
    openMessageInfo(msg);
  };

  editBtn.onclick = async () => {
    hideMessageActions();
    if(msg.deleted) return toast('Message already deleted', 'err');
    if(msg.type !== 'text') return toast('Only text messages can be edited', 'err');
    const next = prompt('Edit message:', msg.text || '');
    if(next === null) return;
    const trimmed = next.trim();
    if(!trimmed) return toast('Message cannot be empty', 'err');
    await editMessage(msg, trimmed);
  };

  delBtn.onclick = async () => {
    hideMessageActions();
    if(!confirm('Delete this message?')) return;
    await deleteMessage(msg);
  };
}

function hideMessageActions(){
  if(actionsMenu) actionsMenu.style.display = 'none';
}

async function editMessage(msg, text){
  msg.text = text;
  msg.editedAt = new Date().toISOString();
  renderMessages(activeConvId);
  updateConversationPreview(activeConvId, msg);
  if(socket && socket.connected){
    socket.emit('message:edit', { conversationId: activeConvId, messageId: msg._id, text });
  }else{
    await api('/api/messages/' + msg._id, { method:'PATCH', body: JSON.stringify({ text }) });
  }
}

async function deleteMessage(msg){
  msg.deleted = true;
  msg.text = '';
  msg.file = null;
  msg.type = 'text';
  renderMessages(activeConvId);
  updateConversationPreview(activeConvId, msg);
  if(socket && socket.connected){
    socket.emit('message:delete', { conversationId: activeConvId, messageId: msg._id });
  }else{
    await api('/api/messages/' + msg._id, { method:'DELETE' });
  }
}

async function uploadFile(file){
  const form = new FormData();
  form.append('file', file);
  const token = getToken();
  const res = await fetch(API_BASE + '/api/upload', {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data.message || 'Upload failed');
  return data.file;
}

function requestNotificationPermission(){
  if(!('Notification' in window)) return;
  if(Notification.permission === 'default'){
    Notification.requestPermission().catch(() => {});
  }
}

function maybeNotify(message, conv){
  if(!('Notification' in window)) return;
  if(document.visibilityState === 'visible') return;
  if(Notification.permission !== 'granted') return;
  const other = getOtherParticipant(conv);
  const body = message.type === 'file'
    ? ('File: ' + (message.file?.name || 'attachment'))
    : (message.text || 'New message');
  const title = conv && conv.isGroup
    ? (conv.name || 'Group')
    : ('@' + (other?.username || 'New message'));
  new Notification(title, { body });
}

(async function init(){
  const ok = await loadMe();
  if(!ok){ showPage('page-landing'); }
})();

