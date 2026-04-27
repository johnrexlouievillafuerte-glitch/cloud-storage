import { api } from './api.js';
import { initAuth, login, register, logout, loginWithGoogle, getUser, onAuthChange, refreshUser } from './auth.js';

const $ = (s, p = document) => p.querySelector(s);
const app = document.getElementById('app');

// State
let state = {
  view: 'grid', // grid | list
  currentFolder: null,
  breadcrumbs: [],
  files: [],
  section: 'files', // files | starred | trash
  searchQuery: '',
  loading: false,
};

// Icons
const icons = {
  folder: '📁', image: '🖼️', video: '🎬', audio: '🎵', pdf: '📄',
  doc: '📝', zip: '📦', code: '💻', text: '📃', file: '📎',
  star: '⭐', trash: '🗑️', home: '🏠', search: '🔍', upload: '☁️',
  grid: '⊞', list: '☰', newFolder: '📂', download: '⬇️', share: '🔗',
  rename: '✏️', copy: '📋', delete: '❌', restore: '♻️', close: '✕',
  logo: '☁️', menu: '☰', logout: '🚪', preview: '👁️',
};

function getFileIcon(file) {
  if (file.is_folder) return icons.folder;
  const m = (file.mime_type || '').split('/')[0];
  if (m === 'image') return icons.image;
  if (m === 'video') return icons.video;
  if (m === 'audio') return icons.audio;
  if (file.mime_type === 'application/pdf') return icons.pdf;
  if ((file.mime_type || '').includes('zip') || (file.mime_type || '').includes('rar')) return icons.zip;
  if ((file.mime_type || '').includes('text')) return icons.text;
  return icons.file;
}

function formatSize(bytes) {
  if (!bytes) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let s = bytes;
  while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function showToast(msg, type = 'info') {
  let c = $('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.remove(); }, 3000);
}

// ===== AUTH SCREEN =====
function renderAuth() {
  function draw() {
    app.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">
        <div class="auth-logo">
          <div class="logo-icon">${icons.logo}</div>
          <span style="font-size:22px;font-weight:700">CloudVault</span>
        </div>
        <h1>Welcome to CloudVault</h1>
        <p class="subtitle">Sign in with your Google account to access your files</p>
        <div id="auth-error"></div>
        <div id="google-signin-btn" class="google-signin-wrapper"></div>
        <div class="auth-divider"><span>Secure cloud storage for everyone</span></div>
        <div class="auth-features">
          <div class="auth-feature">☁️ 2 TB Free Storage</div>
          <div class="auth-feature">🔒 Verified Google Accounts Only</div>
          <div class="auth-feature">📁 Upload, Preview & Share Files</div>
        </div>
      </div>
    </div>`;

    // Render Google Sign-In button
    if (window.google && window.google.accounts) {
      window.google.accounts.id.renderButton(
        document.getElementById('google-signin-btn'),
        { theme: 'filled_blue', size: 'large', width: 340, text: 'signin_with', shape: 'pill', logo_alignment: 'left' }
      );
    } else {
      document.getElementById('google-signin-btn').innerHTML = '<div class="auth-error">Loading Google Sign-In...</div>';
    }
  }
  draw();
}

// ===== MAIN APP =====
async function loadFiles() {
  state.loading = true;
  try {
    let data;
    if (state.section === 'starred') data = await api.getStarred();
    else if (state.section === 'trash') data = await api.getTrash();
    else data = await api.listFiles(state.currentFolder, state.searchQuery || undefined);
    state.files = data.files || [];
    state.breadcrumbs = data.breadcrumbs || [];
  } catch (err) { showToast(err.message, 'error'); }
  state.loading = false;
  renderFileArea();
}

function renderApp() {
  const user = getUser();
  const storagePercent = Math.min(100, ((user.storage_used || 0) / (user.storage_limit || 1)) * 100);

  app.innerHTML = `
  <div class="app-layout">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo"><div class="logo-box">${icons.logo}</div> CloudVault</div>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-section">
          <div class="nav-section-title">Browse</div>
          <button class="nav-item ${state.section === 'files' ? 'active' : ''}" data-section="files"><span class="nav-icon">${icons.home}</span> My Files</button>
          <button class="nav-item ${state.section === 'starred' ? 'active' : ''}" data-section="starred"><span class="nav-icon">${icons.star}</span> Starred</button>
          <button class="nav-item ${state.section === 'trash' ? 'active' : ''}" data-section="trash"><span class="nav-icon">${icons.trash}</span> Trash</button>
        </div>
      </nav>
      <div class="sidebar-footer">
        <div class="storage-meter">
          <div class="meter-label"><span>Storage</span><span>${formatSize(user.storage_used)} / ${formatSize(user.storage_limit)}</span></div>
          <div class="meter-bar"><div class="meter-fill" style="width:${storagePercent}%"></div></div>
        </div>
        <div class="user-profile" id="user-profile">
          <div class="user-avatar">${(user.username || 'U')[0].toUpperCase()}<span class="mini-status-dot online"></span></div>
          <div class="user-info"><div class="user-name">${user.username}</div><div class="user-email">${user.email}</div></div>
        </div>
      </div>
    </aside>
    <main class="main-content">
      <div class="main-header">
        <button class="btn-icon" id="menu-toggle" style="display:none">${icons.menu}</button>
        <div class="search-bar"><span class="search-icon">${icons.search}</span><input id="search-input" placeholder="Search files..." value="${state.searchQuery}" /></div>
        <div class="header-actions">
          <button class="btn-icon ${state.view === 'grid' ? 'active' : ''}" id="view-grid" title="Grid">${icons.grid}</button>
          <button class="btn-icon ${state.view === 'list' ? 'active' : ''}" id="view-list" title="List">${icons.list}</button>
          <button class="btn-icon" id="btn-logout" title="Logout">${icons.logout}</button>
        </div>
      </div>
      <div class="toolbar">
        <div class="breadcrumb" id="breadcrumb"></div>
        ${state.section === 'files' ? `<button class="btn-new-folder" id="btn-new-folder">${icons.newFolder} New Folder</button><button class="btn-upload" id="btn-upload">${icons.upload} Upload</button>` : ''}
        ${state.section === 'trash' && state.files.length > 0 ? '<button class="btn-secondary" id="btn-empty-trash">Empty Trash</button>' : ''}
      </div>
      <div class="file-browser" id="file-browser"></div>
    </main>
  </div>`;

  // Bind sidebar nav
  document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
    btn.onclick = () => {
      state.section = btn.dataset.section;
      state.currentFolder = null;
      state.searchQuery = '';
      loadFiles();
      renderApp();
    };
  });

  // Search
  let searchTimer;
  $('#search-input').oninput = (e) => {
    clearTimeout(searchTimer);
    state.searchQuery = e.target.value;
    searchTimer = setTimeout(() => { state.section = 'files'; loadFiles(); }, 300);
  };

  // View toggle
  $('#view-grid').onclick = () => { state.view = 'grid'; renderFileArea(); document.querySelectorAll('.btn-icon').forEach(b => b.classList.remove('active')); $('#view-grid').classList.add('active'); };
  $('#view-list').onclick = () => { state.view = 'list'; renderFileArea(); document.querySelectorAll('.btn-icon').forEach(b => b.classList.remove('active')); $('#view-list').classList.add('active'); };

  // Logout & Profile
  $('#btn-logout').onclick = logout;
  $('#user-profile').onclick = showProfileModal;

  // Upload & New Folder
  const btnUp = $('#btn-upload');
  if (btnUp) btnUp.onclick = showUploadModal;
  const btnNf = $('#btn-new-folder');
  if (btnNf) btnNf.onclick = showNewFolderModal;
  const btnEt = $('#btn-empty-trash');
  if (btnEt) btnEt.onclick = async () => { if (confirm('Permanently delete all trashed files?')) { await api.emptyTrash(); showToast('Trash emptied', 'success'); await refreshUser(); loadFiles(); renderApp(); } };

  // Mobile menu
  if (window.innerWidth <= 768) { $('#menu-toggle').style.display = 'flex'; }
  const mt = $('#menu-toggle');
  if (mt) mt.onclick = () => $('#sidebar').classList.toggle('open');

  // Drag & drop on file browser
  const fb = $('#file-browser');
  fb.ondragover = (e) => { e.preventDefault(); fb.style.outline = '2px dashed var(--accent)'; };
  fb.ondragleave = () => { fb.style.outline = 'none'; };
  fb.ondrop = async (e) => { e.preventDefault(); fb.style.outline = 'none'; if (e.dataTransfer.files.length) { await handleUpload(e.dataTransfer.files); } };

  loadFiles();
}

function renderBreadcrumbs() {
  const bc = $('#breadcrumb');
  if (!bc) return;
  let html = `<span class="breadcrumb-item ${!state.currentFolder && state.section === 'files' ? 'current' : ''}" data-id="">${state.section === 'starred' ? '⭐ Starred' : state.section === 'trash' ? '🗑️ Trash' : '🏠 My Files'}</span>`;
  for (let i = 0; i < state.breadcrumbs.length; i++) {
    const b = state.breadcrumbs[i];
    const isCurrent = i === state.breadcrumbs.length - 1;
    html += `<span class="breadcrumb-sep">›</span><span class="breadcrumb-item ${isCurrent ? 'current' : ''}" data-id="${b.id}">${b.name}</span>`;
  }
  bc.innerHTML = html;
  bc.querySelectorAll('.breadcrumb-item:not(.current)').forEach(el => {
    el.onclick = () => {
      state.currentFolder = el.dataset.id || null;
      state.section = 'files';
      loadFiles();
    };
  });
}

function renderFileArea() {
  const fb = $('#file-browser');
  if (!fb) return;
  renderBreadcrumbs();

  if (state.loading) { fb.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>'; return; }

  if (state.files.length === 0) {
    fb.innerHTML = `<div class="empty-state"><div class="empty-icon">${state.section === 'trash' ? icons.trash : state.section === 'starred' ? icons.star : icons.folder}</div><h3>${state.section === 'trash' ? 'Trash is empty' : state.section === 'starred' ? 'No starred files' : state.searchQuery ? 'No results found' : 'This folder is empty'}</h3><p>${state.section === 'files' && !state.searchQuery ? 'Drop files here or click Upload' : ''}</p></div>`;
    return;
  }

  if (state.view === 'grid') {
    fb.innerHTML = `<div class="file-grid">${state.files.map(f => `
      <div class="file-card" data-id="${f.id}" data-folder="${f.is_folder}">
        <div class="file-icon">${f.mime_type && f.mime_type.startsWith('image/') && f.storage_key ? `<img src="${api.getPreviewUrl(f.id)}" alt="" loading="lazy" />` : `<span>${getFileIcon(f)}</span>`}</div>
        <div class="file-name" title="${f.name}">${f.name}</div>
        <div class="file-meta"><span>${formatSize(f.size)}</span><span>${formatDate(f.updated_at)}</span></div>
        <button class="star-badge ${f.is_starred ? 'active' : ''}" data-star="${f.id}">${icons.star}</button>
      </div>`).join('')}</div>`;
  } else {
    fb.innerHTML = `<div class="file-list"><div class="file-list-header"><span>Name</span><span>Size</span><span>Modified</span><span></span></div>${state.files.map(f => `
      <div class="file-list-row" data-id="${f.id}" data-folder="${f.is_folder}">
        <div class="file-name-cell"><span class="icon">${getFileIcon(f)}</span><span title="${f.name}">${f.name}</span></div>
        <span class="file-size">${formatSize(f.size)}</span>
        <span class="file-date">${formatDate(f.updated_at)}</span>
        <span>${f.is_starred ? icons.star : ''}</span>
      </div>`).join('')}</div>`;
  }

  // Bind clicks
  fb.querySelectorAll('[data-id]').forEach(el => {
    if (el.classList.contains('star-badge')) return;
    el.ondblclick = () => {
      const id = el.dataset.id;
      if (el.dataset.folder === '1') { state.currentFolder = id; loadFiles(); }
      else { showPreview(id); }
    };
    el.oncontextmenu = (e) => { e.preventDefault(); showContextMenu(e, el.dataset.id); };
  });

  // Star badges
  fb.querySelectorAll('[data-star]').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const id = el.dataset.star;
      const file = state.files.find(f => String(f.id) === String(id));
      if (file) { await api.updateFile(id, { is_starred: !file.is_starred }); loadFiles(); }
    };
  });
}

// ===== CONTEXT MENU =====
function showContextMenu(e, fileId) {
  removeContextMenu();
  const file = state.files.find(f => String(f.id) === String(fileId));
  if (!file) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'context-menu';

  let items = [];
  if (state.section === 'trash') {
    items.push({ label: 'Restore', icon: icons.restore, action: async () => { await api.updateFile(fileId, { is_trashed: false }); showToast('Restored', 'success'); loadFiles(); } });
    items.push({ label: 'Delete Permanently', icon: icons.delete, danger: true, action: async () => { if (confirm('Delete permanently?')) { await api.deleteFile(fileId); showToast('Deleted', 'success'); loadFiles(); } } });
  } else {
    if (!file.is_folder) {
      items.push({ label: 'Preview', icon: icons.preview, action: () => showPreview(fileId) });
      items.push({ label: 'Download', icon: icons.download, action: () => { api.downloadFile(fileId, file.name); } });
      items.push('divider');
    }
    if (file.is_folder) {
      items.push({ label: 'Open', icon: icons.folder, action: () => { state.currentFolder = fileId; loadFiles(); } });
      items.push('divider');
    }
    items.push({ label: file.is_starred ? 'Unstar' : 'Star', icon: icons.star, action: async () => { await api.updateFile(fileId, { is_starred: !file.is_starred }); loadFiles(); } });
    items.push({ label: 'Rename', icon: icons.rename, action: () => showRenameModal(file) });
    if (!file.is_folder) {
      items.push({ label: 'Copy', icon: icons.copy, action: async () => { await api.copyFile(fileId); showToast('Copied', 'success'); loadFiles(); } });
      items.push({ label: 'Share', icon: icons.share, action: () => showShareModal(file) });
    }
    items.push('divider');
    items.push({ label: 'Move to Trash', icon: icons.trash, danger: true, action: async () => { await api.updateFile(fileId, { is_trashed: true }); showToast('Moved to trash', 'success'); loadFiles(); } });
  }

  menu.innerHTML = items.map(it => it === 'divider' ? '<div class="context-menu-divider"></div>' : `<button class="context-menu-item ${it.danger ? 'danger' : ''}">${it.icon} ${it.label}</button>`).join('');

  const buttons = menu.querySelectorAll('.context-menu-item');
  let bi = 0;
  items.forEach(it => { if (it !== 'divider') { buttons[bi].onclick = () => { removeContextMenu(); it.action(); }; bi++; } });

  menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 300) + 'px';
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', removeContextMenu, { once: true }), 10);
}

function removeContextMenu() { const m = $('#context-menu'); if (m) m.remove(); }

// ===== MODALS =====
function showModal(content) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">${content}</div>`;
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  return overlay;
}

function closeModal() { const m = $('#modal-overlay'); if (m) m.remove(); }

function showNewFolderModal() {
  const overlay = showModal(`<h2>${icons.newFolder} New Folder</h2><div class="form-group"><label>Folder name</label><input id="folder-name" placeholder="Untitled folder" autofocus /></div><div class="modal-actions"><button class="btn-secondary" id="modal-cancel">Cancel</button><button class="btn-primary" style="width:auto;padding:8px 20px" id="modal-confirm">Create</button></div>`);
  $('#modal-cancel').onclick = closeModal;
  $('#modal-confirm').onclick = async () => {
    const name = $('#folder-name').value.trim();
    if (!name) return;
    await api.createFolder(name, state.currentFolder);
    showToast('Folder created', 'success');
    closeModal();
    loadFiles();
  };
  $('#folder-name').onkeydown = (e) => { if (e.key === 'Enter') $('#modal-confirm').click(); };
}

function showRenameModal(file) {
  const overlay = showModal(`<h2>${icons.rename} Rename</h2><div class="form-group"><label>New name</label><input id="rename-input" value="${file.name}" autofocus /></div><div class="modal-actions"><button class="btn-secondary" id="modal-cancel">Cancel</button><button class="btn-primary" style="width:auto;padding:8px 20px" id="modal-confirm">Rename</button></div>`);
  $('#modal-cancel').onclick = closeModal;
  $('#modal-confirm').onclick = async () => {
    const name = $('#rename-input').value.trim();
    if (!name) return;
    await api.updateFile(file.id, { name });
    showToast('Renamed', 'success');
    closeModal();
    loadFiles();
  };
  $('#rename-input').onkeydown = (e) => { if (e.key === 'Enter') $('#modal-confirm').click(); };
  setTimeout(() => { const inp = $('#rename-input'); inp.focus(); inp.select(); }, 50);
}

function showUploadModal() {
  const overlay = showModal(`<h2>${icons.upload} Upload Files</h2><div class="upload-zone" id="upload-zone"><div class="upload-icon">${icons.upload}</div><p>Drag & drop files here</p><p class="upload-hint">or click to browse</p><input type="file" id="file-input" multiple hidden /></div><div class="upload-progress" id="upload-progress"></div><div class="modal-actions"><button class="btn-secondary" id="modal-cancel">Close</button></div>`);
  const zone = $('#upload-zone');
  const input = $('#file-input');
  zone.onclick = () => input.click();
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('drag-over'); };
  zone.ondragleave = () => zone.classList.remove('drag-over');
  zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove('drag-over'); handleUpload(e.dataTransfer.files); };
  input.onchange = () => { if (input.files.length) handleUpload(input.files); };
  $('#modal-cancel').onclick = closeModal;
}

async function handleUpload(fileList) {
  const prog = $('#upload-progress');
  if (prog) prog.innerHTML = Array.from(fileList).map(f => `<div class="upload-item"><span class="upload-file-name">${f.name}</span><div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div></div>`).join('');

  try {
    await api.uploadFiles(fileList, state.currentFolder, (pct) => {
      if (prog) prog.querySelectorAll('.progress-fill').forEach(el => el.style.width = pct + '%');
    });
    showToast(`${fileList.length} file(s) uploaded`, 'success');
    await refreshUser();
    closeModal();
    loadFiles();
    // Update storage meter
    const user = getUser();
    const meter = $('.meter-fill');
    if (meter && user) meter.style.width = Math.min(100, (user.storage_used / user.storage_limit) * 100) + '%';
  } catch (err) { showToast(err.message, 'error'); }
}

function showPreview(fileId) {
  const file = state.files.find(f => String(f.id) === String(fileId));
  if (!file) return;
  const url = api.getPreviewUrl(fileId);
  const m = file.mime_type || '';
  let body = '';

  if (m.startsWith('image/')) body = `<img src="${url}" alt="${file.name}" />`;
  else if (m.startsWith('video/')) body = `<video src="${url}" controls autoplay></video>`;
  else if (m.startsWith('audio/')) body = `<audio src="${url}" controls autoplay></audio>`;
  else if (m === 'application/pdf') body = `<iframe src="${url}"></iframe>`;
  else if (m.startsWith('text/') || ['application/json', 'application/javascript', 'application/xml'].some(t => m.includes(t))) {
    body = '<pre id="preview-text">Loading...</pre>';
    fetch(url, { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } })
      .then(r => r.text()).then(t => { const el = $('#preview-text'); if (el) el.textContent = t; });
  } else body = `<div class="empty-state"><div class="empty-icon">${getFileIcon(file)}</div><h3>Preview not available</h3><p>${file.name}</p></div>`;

  const overlay = document.createElement('div');
  overlay.className = 'preview-overlay';
  overlay.id = 'preview-overlay';
  overlay.innerHTML = `<div class="preview-header"><span class="file-name">${getFileIcon(file)} ${file.name}</span><div style="display:flex;gap:8px"><button class="btn-icon" id="preview-download" title="Download">${icons.download}</button><button class="btn-icon" id="preview-close" title="Close">${icons.close}</button></div></div><div class="preview-body">${body}</div>`;
  document.body.appendChild(overlay);
  $('#preview-close').onclick = () => overlay.remove();
  $('#preview-download').onclick = () => api.downloadFile(fileId, file.name);
  overlay.onkeydown = (e) => { if (e.key === 'Escape') overlay.remove(); };
}

function showShareModal(file) {
  const overlay = showModal(`<h2>${icons.share} Share "${file.name}"</h2><p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px">Generate a public link to share this file.</p><div class="form-group"><label>Permission</label><select id="share-perm"><option value="view">View only</option><option value="download">View & Download</option></select></div><div id="share-result"></div><div class="modal-actions"><button class="btn-secondary" id="modal-cancel">Close</button><button class="btn-primary" style="width:auto;padding:8px 20px" id="share-create">Create Link</button></div>`);
  $('#modal-cancel').onclick = closeModal;
  $('#share-create').onclick = async () => {
    try {
      const data = await api.createShare(file.id, { permission: $('#share-perm').value });
      const link = `${window.location.origin}/shared/${data.share.token}`;
      $('#share-result').innerHTML = `<div class="share-link-box"><input id="share-url" value="${link}" readonly /><button class="btn-copy" id="share-copy">Copy</button></div>`;
      $('#share-copy').onclick = () => { navigator.clipboard.writeText(link); showToast('Link copied!', 'success'); };
    } catch (err) { showToast(err.message, 'error'); }
  };
}

// ===== PROFILE MODAL =====
function showProfileModal() {
  const user = getUser();
  if (!user) return;
  const storagePercent = Math.min(100, ((user.storage_used || 0) / (user.storage_limit || 1)) * 100);
  const fileCount = state.files ? state.files.length : 0;
  const joined = user.created_at ? formatDate(user.created_at) : 'Unknown';
  const currentStatus = user.status || 'Hey there! I am using CloudVault.';

  const overlay = showModal(`
    <div class="profile-modal">
      <div class="profile-header">
        <div class="profile-avatar">
          ${(user.username || 'U')[0].toUpperCase()}
          <span class="status-dot online"></span>
        </div>
        <div class="profile-username">${user.username}</div>
        <div class="profile-email">${user.email}</div>
        <div class="profile-status-text">"${currentStatus}"</div>
      </div>
      <div class="profile-stats">
        <div class="profile-stat">
          <span class="stat-value">${formatSize(user.storage_used)}</span>
          <span class="stat-label">Used</span>
        </div>
        <div class="profile-stat">
          <span class="stat-value">${formatSize(user.storage_limit)}</span>
          <span class="stat-label">Limit</span>
        </div>
        <div class="profile-stat">
          <span class="stat-value">${storagePercent.toFixed(1)}%</span>
          <span class="stat-label">Usage</span>
        </div>
      </div>
      <div class="profile-form">
        <div class="form-group">
          <label>Username</label>
          <input id="profile-username" value="${user.username}" />
        </div>
        <div class="form-group">
          <label>Status Message</label>
          <input id="profile-status" value="${currentStatus}" maxlength="255" />
        </div>
      </div>
      <div class="profile-joined">Member since ${joined}</div>
      <div class="modal-actions">
        <button class="btn-secondary" id="profile-logout">🚪 Logout</button>
        <button class="btn-primary" style="width:auto;padding:8px 20px" id="profile-save">Save Changes</button>
      </div>
    </div>
  `);

  $('#profile-logout').onclick = () => { closeModal(); logout(); };
  $('#profile-save').onclick = async () => {
    const newUsername = $('#profile-username').value.trim();
    const newStatus = $('#profile-status').value;
    if (!newUsername) { showToast('Username cannot be empty', 'error'); return; }
    try {
      const data = await api.updateProfile({ username: newUsername, status: newStatus });
      showToast('Profile updated!', 'success');
      await refreshUser();
      closeModal();
      renderApp();
    } catch (err) { showToast(err.message, 'error'); }
  };
}

// ===== INIT =====
async function init() {
  app.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

  // Listen for Google credential
  window.addEventListener('google-credential', async (e) => {
    try {
      await loginWithGoogle(e.detail);
    } catch (err) {
      const errEl = document.getElementById('auth-error');
      if (errEl) errEl.innerHTML = `<div class="auth-error">${err.message}</div>`;
      showToast(err.message, 'error');
    }
  });

  // Initialize Google Identity Services
  function initGoogleSignIn() {
    if (window.google && window.google.accounts) {
      window.google.accounts.id.initialize({
        client_id: '999112386476-12ql8koafnrmtc0gpmep8il19shmim7v.apps.googleusercontent.com',
        callback: window.handleGoogleCredential,
        auto_select: false,
      });
    } else {
      setTimeout(initGoogleSignIn, 500);
    }
  }
  initGoogleSignIn();

  onAuthChange((user) => { user ? renderApp() : renderAuth(); });
  await initAuth();
  if (!getUser()) renderAuth();
}

init();

