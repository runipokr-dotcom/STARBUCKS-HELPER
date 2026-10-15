const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAQpr3_koSKTAfihI8E3-kW3PknfMrQdaA",
  authDomain: "starbucks-helper-f578e.firebaseapp.com",
  projectId: "starbucks-helper-f578e",
  storageBucket: "starbucks-helper-f578e.firebasestorage.app",
  messagingSenderId: "1015231512258",
  appId: "1:1015231512258:web:25bb0229b5bc90b56a455b",
  measurementId: "G-8H2H0NCJDF",
};

const APP_NAME = "starbucks-helper-admin-auth-v1";
const OWNER_UID = "DFtc3qItyZQYmE9m4q2JgXJyqrW2";
const LOGOUT_SIGNAL_KEY = "starbucks-helper-admin-logout-v1";
let contextPromise;
let lifecycleInstalled = false;
let sessionEnding = false;

function waitForInitialAuth(auth, onAuthStateChanged) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user);
      },
      reject,
    );
  });
}

function ensureLoginStyles() {
  if (document.getElementById("firebase-admin-auth-style")) return;
  const style = document.createElement("style");
  style.id = "firebase-admin-auth-style";
  style.textContent = `
    .firebase-admin-auth-backdrop{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:rgba(12,18,14,.72)}
    .firebase-admin-auth-card{width:min(420px,100%);padding:22px;border-radius:14px;background:#fff;color:#151916;box-shadow:0 20px 60px rgba(0,0,0,.28);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .firebase-admin-auth-card h1{margin:0 0 8px;font-size:22px}.firebase-admin-auth-card p{margin:0 0 16px;color:#536159;line-height:1.5}
    .firebase-admin-auth-card label{display:grid;gap:6px;margin:12px 0;font-size:13px;font-weight:800}.firebase-admin-auth-card input{width:100%;height:44px;padding:0 11px;border:1px solid #aebbb3;border-radius:8px;font:inherit}
    .firebase-admin-auth-card button{width:100%;min-height:44px;margin-top:8px;border:0;border-radius:8px;background:#006241;color:#fff;font:inherit;font-weight:800;cursor:pointer}.firebase-admin-auth-card button:disabled{opacity:.55;cursor:wait}
    .firebase-admin-auth-card button.secondary{border:1px solid #c7d0ca;background:#fff;color:#253029}
    .firebase-admin-auth-error{min-height:21px;margin-top:10px;color:#9b1c1c;font-size:13px}
    .firebase-admin-signout{position:fixed;right:12px;bottom:12px;z-index:2147483000;min-height:38px;padding:0 12px;border:1px solid #c7d0ca;border-radius:999px;background:#fff;color:#253029;font:700 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.12);cursor:pointer}
    html.firebase-admin-session-locked body>:not(#helperPinGate):not(.firebase-admin-auth-backdrop):not(.firebase-admin-signout){visibility:hidden!important}
  `;
  document.head.append(style);
}

function waitForBody() {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener("DOMContentLoaded", resolve, { once: true });
  });
}

function lockAdminUi(reason) {
  ensureLoginStyles();
  document.documentElement.classList.add("firebase-admin-session-locked");
  window.dispatchEvent(new CustomEvent("firebase-admin-session-ended", {
    detail: { reason },
  }));
}

async function requestLogin(auth, authApi) {
  await waitForBody();
  ensureLoginStyles();
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "firebase-admin-auth-backdrop";
    const card = document.createElement("form");
    card.className = "firebase-admin-auth-card";

    const title = document.createElement("h1");
    title.textContent = "관리자 로그인";
    const description = document.createElement("p");
    description.textContent = "기존 Firebase 관리자 계정으로 로그인해야 내부 데이터를 불러옵니다.";
    const emailLabel = document.createElement("label");
    emailLabel.textContent = "이메일";
    const email = document.createElement("input");
    email.type = "email";
    email.autocomplete = "username";
    email.required = true;
    const passwordLabel = document.createElement("label");
    passwordLabel.textContent = "비밀번호";
    const password = document.createElement("input");
    password.type = "password";
    password.autocomplete = "current-password";
    password.required = true;
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "로그인";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = "취소하고 고객 페이지로";
    const error = document.createElement("div");
    error.className = "firebase-admin-auth-error";
    error.setAttribute("role", "alert");

    emailLabel.append(email);
    passwordLabel.append(password);
    card.append(title, description, emailLabel, passwordLabel, submit, cancel, error);
    backdrop.append(card);
    document.body.append(backdrop);
    email.focus();

    cancel.addEventListener("click", () => {
      password.value = "";
      location.replace("share.html?id=c6xxh9");
    });

    card.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      error.textContent = "";
      try {
        const credential = await authApi.signInWithEmailAndPassword(
          auth,
          email.value.trim(),
          password.value,
        );
        password.value = "";
        if (credential.user.uid !== OWNER_UID) {
          await authApi.signOut(auth);
          error.textContent = "로그인할 수 없습니다. 계정 상태와 입력 내용을 확인해 주세요.";
          submit.disabled = false;
          password.focus();
          return;
        }
        backdrop.remove();
        resolve(credential.user);
      } catch (loginError) {
        console.error("[admin-auth] sign-in failed", loginError?.code || "unknown");
        password.value = "";
        error.textContent = "로그인할 수 없습니다. 계정 상태와 입력 내용을 확인해 주세요.";
        submit.disabled = false;
        password.focus();
      }
    });
  });
}

async function finishSession(auth, authApi, reason, { broadcast = false } = {}) {
  if (sessionEnding) return;
  sessionEnding = true;
  lockAdminUi(reason);
  try {
    await authApi.signOut(auth);
    if (broadcast) localStorage.setItem(LOGOUT_SIGNAL_KEY, String(Date.now()));
    location.reload();
  } catch (error) {
    location.reload();
    throw error;
  }
}

function installSessionLifecycle(auth, authApi) {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;

  authApi.onIdTokenChanged(auth, (user) => {
    if (!user || user.uid !== OWNER_UID) {
      finishSession(auth, authApi, "auth-state-changed").catch((error) => {
        console.error("[admin-auth] session end failed", error?.code || "unknown");
      });
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== LOGOUT_SIGNAL_KEY || !event.newValue) return;
    finishSession(auth, authApi, "cross-tab-logout").catch((error) => {
      console.error("[admin-auth] cross-tab sign-out failed", error?.code || "unknown");
      location.reload();
    });
  });

  let refreshing = false;
  const revalidate = async () => {
    if (refreshing || sessionEnding || document.hidden) return;
    refreshing = true;
    try {
      const user = auth.currentUser;
      if (!user || user.uid !== OWNER_UID) throw new Error("owner session missing");
      await authApi.getIdToken(user, true);
    } catch (error) {
      console.error("[admin-auth] token refresh failed", error?.code || "unknown");
      await finishSession(auth, authApi, "token-refresh-failed", { broadcast: true });
    } finally {
      refreshing = false;
    }
  };
  window.addEventListener("focus", revalidate);
  document.addEventListener("visibilitychange", revalidate);
}

function installSignOut(auth, authApi) {
  if (document.getElementById("firebase-admin-signout")) return;
  ensureLoginStyles();
  const button = document.createElement("button");
  button.id = "firebase-admin-signout";
  button.className = "firebase-admin-signout";
  button.type = "button";
  button.textContent = "관리자 로그아웃";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await finishSession(auth, authApi, "explicit-logout", { broadcast: true });
    } catch (error) {
      console.error("[admin-auth] sign-out failed", error?.code || "unknown");
      button.disabled = false;
    }
  });
  document.body.append(button);
}

export async function requireAdminSession() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const [appApi, authApi] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js"),
      ]);
      const app = appApi.getApps().find((item) => item.name === APP_NAME)
        || appApi.initializeApp(FIREBASE_CONFIG, APP_NAME);
      const auth = authApi.getAuth(app);
      await authApi.setPersistence(auth, authApi.browserSessionPersistence);
      const existing = await waitForInitialAuth(auth, authApi.onAuthStateChanged);
      if (existing && existing.uid !== OWNER_UID) await authApi.signOut(auth);
      let user = existing?.uid === OWNER_UID ? existing : await requestLogin(auth, authApi);
      try {
        await authApi.getIdToken(user, true);
      } catch (error) {
        console.error("[admin-auth] initial token refresh failed", error?.code || "unknown");
        await authApi.signOut(auth);
        user = await requestLogin(auth, authApi);
        await authApi.getIdToken(user, true);
      }
      installSessionLifecycle(auth, authApi);
      installSignOut(auth, authApi);
      return { app, auth, user };
    })().catch((error) => {
      contextPromise = null;
      throw error;
    });
  }
  return contextPromise;
}
