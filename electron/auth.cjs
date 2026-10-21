'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
// Fixed application account. This is an application-local credential check, not
// a cloud identity service. No plaintext password or local account file is used.
const ACCOUNT = Object.freeze(require('./unified-account.local.cjs'));
const MAX_FAILURES = 5, BASE_COOLDOWN_MS = 30000, MAX_COOLDOWN_MS = 15 * 60000;
// Shared by createAuth instances in this process; restarting the process resets
// throttling but always requires a fresh session. The host has a single-instance lock.
let queue = Promise.resolve(), failures = 0, cooldownUntil = 0;
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
function serial(work) {
  const result = queue.catch(() => {}).then(work);
  queue = result;
  return result;
}
function normalizeUsername(value) {
  return typeof value === 'string' && value.length <= 254 ? value.trim().toLowerCase() : '';
}
function usablePassword(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && Buffer.byteLength(value, 'utf8') <= 512;
}

/** userData is deliberately ignored: old accounts and damaged account files
 * cannot alter the fixed account. `now` is injectable for deterministic tests.
 * Sessions stay in memory and confer no OS-user isolation or tool-data encryption.
 */
function createAuth({ now = Date.now } = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  let session = null, epoch = 0;
  const getSession = () => ({ authenticated: Boolean(session), user: session ? { ...session } : null });
  const timestamp = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000 - MAX_COOLDOWN_MS) throw fail('AUTH_UNAVAILABLE', '系统时间无效，无法处理登录。');
    return value;
  };
  const cooldown = () => { const currentTime = timestamp(); return cooldownUntil > currentTime ? { cooldownUntil: new Date(cooldownUntil).toISOString(), retryAfterMs: cooldownUntil - currentTime } : {}; };
  const checkEpoch = expected => { if (expected !== epoch) throw fail('AUTH_CANCELLED', '登录已取消，请重新登录。'); };
  return {
    getSession,
    logout() { epoch++; session = null; return getSession(); },
    async status() { return { setupRequired: false, accountMode: 'unified', ...getSession(), cooldownUntil: cooldown().cooldownUntil || null }; },
    async register() { throw fail('AUTH_REGISTRATION_DISABLED', '当前使用统一账户，不支持创建本机账户。'); },
    login({ username, password } = {}) {
      const expectedEpoch = epoch;
      return serial(async () => {
        checkEpoch(expectedEpoch);
        const blocked = cooldown();
        if (blocked.cooldownUntil) throw fail('AUTH_RATE_LIMITED', '登录尝试过多，请稍后重试。', blocked);
        const validInput = usablePassword(password);
        const parameters = ACCOUNT.parameters;
        const candidate = await scrypt(validInput ? password : 'invalid-login-input', Buffer.from(ACCOUNT.salt, 'hex'), parameters.keylen, { N: parameters.N, r: parameters.r, p: parameters.p, maxmem: 64 * 1024 * 1024 });
        const matches = crypto.timingSafeEqual(candidate, Buffer.from(ACCOUNT.hash, 'hex'));
        candidate.fill(0);
        checkEpoch(expectedEpoch);
        if (!validInput || normalizeUsername(username) !== ACCOUNT.username || !matches) {
          failures = Math.min(failures + 1, 1000);
          cooldownUntil = failures >= MAX_FAILURES ? timestamp() + Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** Math.min(failures - MAX_FAILURES, 10)) : 0;
          throw fail('AUTH_INVALID_CREDENTIALS', '邮箱或密码不正确。', cooldown());
        }
        failures = 0; cooldownUntil = 0;
        session = { username: ACCOUNT.username, displayName: ACCOUNT.displayName };
        return getSession();
      });
    },
  };
}

module.exports = { createAuth };
