// Share a five-minute sign-in window across server 3 and its home dashboard.
export const SESSION_MS = 5 * 60 * 1000;
export function remainingSessionMs(authTime, now = Date.now()) {
  const signedInAt = Date.parse(authTime);
  if (!Number.isFinite(signedInAt) || signedInAt > now + 60000) return 0;
  return Math.max(0, Math.min(SESSION_MS, signedInAt + SESSION_MS - now));
}
export function watchServer3Session(auth, api, onSession) {
  let timer, generation = 0, expiresAt = 0, stopped = false;
  const expire = () => {
    if (!auth.currentUser || !expiresAt || Date.now() < expiresAt) return;
    generation++;
    expiresAt = 0;
    clearTimeout(timer);
    onSession(null);
    api.signOut(auth).catch(() => {});
  };
  const off = api.onAuthStateChanged(auth, async user => {
    const current = ++generation;
    clearTimeout(timer);
    expiresAt = 0;
    if (!user) { onSession(null); return; }
    try {
      const token = await api.getIdTokenResult(user);
      if (stopped || current !== generation) return;
      const remaining = remainingSessionMs(token.authTime);
      if (!remaining) { onSession(null); await api.signOut(auth); return; }
      expiresAt = Date.now() + remaining;
      timer = setTimeout(expire, remaining);
      onSession(user);
    } catch {
      if (!stopped && current === generation) onSession(null);
    }
  });
  const resume = () => { if (!document.hidden) expire(); };
  window.addEventListener('focus', expire);
  document.addEventListener('visibilitychange', resume);
  return () => { stopped = true; generation++; clearTimeout(timer); off(); window.removeEventListener('focus', expire); document.removeEventListener('visibilitychange', resume); };
}
