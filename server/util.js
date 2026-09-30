// 通用工具：错误类型、时间（epoch 分钟）与校验

export class ApiError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// 当前时刻，epoch 分钟
export function nowMinute() {
  return Math.floor(Date.now() / 60000);
}

/**
 * 解析提交的时刻，转换为 epoch 分钟（向分钟取整）。
 * 接受 ISO8601（2026-09-30T08:30、2026-09-30 08:30、含 Z 或 +08:00）。
 * 纯日期按 UTC 00:00 处理。无法解析或非有限时间抛 INVALID_TIME。
 */
export function parseTime(value, field = 'time') {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // 视为 epoch 分钟
    if (!Number.isInteger(value) || value < 0) {
      throw new ApiError('INVALID_TIME', `${field} 不是有效的时刻`);
    }
    return value;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError('INVALID_TIME', `${field} 不是有效的时刻`);
  }
  let s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s = s + 'T00:00Z';
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
    s = s.replace(' ', 'T') + 'Z';
  }
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) {
    throw new ApiError('INVALID_TIME', `${field} 不是有效的时刻`);
  }
  return Math.floor(ms / 60000);
}

// epoch 分钟 -> UTC ISO（分钟精度，Z 结尾）
export function fmtTime(minute) {
  return new Date(minute * 60000).toISOString().slice(0, 16) + 'Z';
}

const ID_RE = /^[\p{L}\p{N}_-]{1,32}$/u;

export function validateNodeId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new ApiError(
      'INVALID_NODE',
      `节点标识非法：${JSON.stringify(id)}；允许 1-32 位文字、数字、下划线或连字符`
    );
  }
}

export function validateName(name, id) {
  if (typeof name !== 'string' || name.trim() === '' || name.length > 64) {
    throw new ApiError('INVALID_NODE', `节点 ${id} 的名称须为 1-64 字符`);
  }
  return name.trim();
}

export function validateMinutes(minutes) {
  if (typeof minutes === 'boolean' || !Number.isInteger(minutes) || minutes <= 0) {
    throw new ApiError('INVALID_EDGE', `通行分钟须为正整数，收到：${JSON.stringify(minutes)}`);
  }
  return minutes;
}

export function validateHasSteps(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (v === 1 || v === 0) return v;
  throw new ApiError('INVALID_EDGE', `has_steps 须为布尔值，收到：${JSON.stringify(v)}`);
}

// 半开区间重叠：[aStart,aEnd) 与 [bStart,bEnd)
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
