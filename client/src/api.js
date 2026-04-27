const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocal ? '/api' : 'https://lighting-sort-jade-hollow.trycloudflare.com/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(endpoint, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    if (options.body && typeof options.body === 'object') {
      options.body = JSON.stringify(options.body);
    }
  }

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

  let data;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Server error (${res.status})`);
  }

  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

export const api = {
  // Auth
  register: (body) => request('/auth/register', { method: 'POST', body }),
  login: (body) => request('/auth/login', { method: 'POST', body }),
  googleAuth: (credential) => request('/auth/google', { method: 'POST', body: { credential } }),
  getMe: () => request('/auth/me'),
  updateProfile: (body) => request('/auth/me', { method: 'PATCH', body }),

  // Files
  listFiles: (parentId, search) => {
    const params = new URLSearchParams();
    if (parentId) params.set('parent_id', parentId);
    if (search) params.set('search', search);
    return request(`/files?${params}`);
  },
  getFile: (id) => request(`/files/${id}`),
  createFolder: (name, parentId) => request('/files/folder', { method: 'POST', body: { name, parent_id: parentId } }),
  uploadFiles: (files, parentId, onProgress) => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      for (const file of files) formData.append('files', file);
      if (parentId) formData.append('parent_id', parentId);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/files/upload`);
      const token = getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          try { reject(new Error(JSON.parse(xhr.responseText).error)); }
          catch { reject(new Error('Upload failed')); }
        }
      };

      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    });
  },
  updateFile: (id, body) => request(`/files/${id}`, { method: 'PATCH', body }),
  deleteFile: (id) => request(`/files/${id}`, { method: 'DELETE' }),
  copyFile: (id) => request(`/files/${id}/copy`, { method: 'POST' }),
  getStarred: () => request('/files/starred'),
  getTrash: () => request('/files/trash'),
  emptyTrash: () => request('/files/trash/empty', { method: 'POST' }),
  getDownloadUrl: (id) => `${API_BASE}/files/${id}/download?token=${getToken()}`,
  getPreviewUrl: (id) => `${API_BASE}/files/${id}/preview?token=${getToken()}`,
  downloadFile: (id, filename) => {
    const a = document.createElement('a');
    a.href = `${API_BASE}/files/${id}/download?token=${getToken()}`;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  // Share
  createShare: (fileId, body = {}) => request(`/share/${fileId}`, { method: 'POST', body }),
  getShare: (token) => request(`/share/${token}`),
  deleteShare: (shareId) => request(`/share/${shareId}`, { method: 'DELETE' }),
  getShareLinks: (fileId) => request(`/share/file/${fileId}/links`),
  getShareDownloadUrl: (token) => `${API_BASE}/share/${token}/download`,
  getSharePreviewUrl: (token) => `${API_BASE}/share/${token}/preview`,
};
