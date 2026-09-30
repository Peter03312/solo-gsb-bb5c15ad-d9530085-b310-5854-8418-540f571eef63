// API 封装与时间转换（界面使用浏览器本地时区，接口使用 epoch 分钟 / UTC ISO）

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const err = new Error((data && data.message) || `请求失败（${res.status}）`);
    err.status = res.status;
    err.code = data && data.error;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request('/api/health'),
  getDraft: () => request('/api/draft'),
  putDraft: (draft) => request('/api/draft', { method: 'PUT', body: JSON.stringify(draft) }),
  publish: () => request('/api/publish', { method: 'POST' }),
  versions: () => request('/api/versions'),
  version: (v) => request(`/api/versions/${v}`),
  latestNetwork: () => request('/api/network/latest'),
  closures: () => request('/api/closures'),
  addClosure: (c) => request('/api/closures', { method: 'POST', body: JSON.stringify(c) }),
  deleteClosure: (id) => request(`/api/closures/${id}`, { method: 'DELETE' }),
  route: (params) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    }
    return request(`/api/route?${qs.toString()}`);
  }
};

// datetime-local <-> UTC ISO（服务端按 Z 解析）
export function toLocalInput(isoZ) {
  if (!isoZ) return '';
  const d = new Date(isoZ);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToUtc(localValue) {
  if (!localValue) return '';
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16) + 'Z';
}

// UTC ISO -> 本地可读串
export function fmtLocal(isoZ) {
  if (!isoZ) return '';
  const d = new Date(isoZ);
  if (Number.isNaN(d.getTime())) return isoZ;
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 用于 datetime-local 的默认值（当前时间后整 5 分钟）
export function defaultDeparture() {
  const d = new Date(Date.now() + 5 * 60000);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  d.setMinutes(m + (5 - (m % 5)));
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
