async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({ ok: false, message: '响应解析失败' }));
  if (!res.ok) {
    const err = new Error(data.message || `请求失败 (${res.status})`);
    err.code = data.code;
    err.errors = data.errors;
    throw err;
  }
  return data;
}

export const api = {
  getDraft: () => request('/api/draft'),
  saveDraft: (draft) => request('/api/draft', { method: 'PUT', body: JSON.stringify(draft) }),
  publish: () => request('/api/publish', { method: 'POST', body: '{}' }),
  getVersions: () => request('/api/versions'),
  getVersion: (id) => request(`/api/versions/${id}`),
  getClosures: () => request('/api/closures'),
  addClosure: (c) => request('/api/closures', { method: 'POST', body: JSON.stringify(c) }),
  queryRoute: (params) => request('/api/route?' + new URLSearchParams(params).toString()),
};

// datetime-local 值 -> ISO 字符串（按浏览器本地时区解释）
export function localToIso(local) {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function fmtTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
