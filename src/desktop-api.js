export const isDesktop = () => Boolean(window.momoDesktop);
export async function desktopCall(method, ...args) {
  const api = window.momoDesktop;
  if (!api || typeof api[method] !== 'function') throw new Error('请在 Momo 桌面应用中使用这项功能。');
  const value = await api[method](...args);
  if (value && value.ok === false) { const error=new Error(value.error || '操作未完成，请重试。');error.code=value.code;error.operationId=value.operationId;error.retryAfterMs=value.retryAfterMs;error.cooldownUntil=value.cooldownUntil;throw error; }
  return value;
}
export const friendlyError = error => error?.message || '操作没有完成，请稍后再试。';
