/*
STARBUCKS HELPER
File : catalog-sync.js
Version : 1.1
Updated : 2026-09-04
Purpose : Cross-device catalog sync + mobile link queue.

- PC keeps the existing localhost extractor.
- Mobile sends product links to a shared Firestore queue instead of localhost.
- PC processes queued links through the existing import button.
- Product metadata is mirrored so PC/mobile see the same catalog.
- First sync protects an existing non-empty local catalog from an empty cloud copy.
*/
(() => {
  if (window.__starbucksCatalogSyncLoaded) return;
  window.__starbucksCatalogSyncLoaded = true;

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAQpr3_koSKTAfihI8E3-kW3PknfMrQdaA",
    authDomain: "starbucks-helper-f578e.firebaseapp.com",
    projectId: "starbucks-helper-f578e",
    storageBucket: "starbucks-helper-f578e.firebasestorage.app",
    messagingSenderId: "1015231512258",
    appId: "1:1015231512258:web:25bb0229b5bc90b56a455b",
    measurementId: "G-8H2H0NCJDF",
  };

  const COLLECTION = "catalogShares";
  const WORKSPACE_ID = "work-k4m8q2x7n9v3c6p5r8t1";
  const SYNC_STAMP_KEY = "starbucks-helper-catalog-cloud-stamp-v1";
  const DEVICE_ID_KEY = "starbucks-helper-catalog-device-v1";
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  let f = null;
  let db = null;
  let ref = null;
  let initialized = false;
  let applyingRemote = false;
  let writeTimer = null;
  let queueBusy = false;
  let latestQueue = [];

  const deviceId = (() => {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `${isMobile ? "m" : "p"}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  })();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const now = () => Date.now();
  const safeArray = (value) => (Array.isArray(value) ? value : []);

  function toastSafe(message) {
    try {
      if (typeof toast === "function") return toast(message);
    } catch {}
    console.log("[catalog-sync]", message);
  }

  function validProductLink(raw) {
    try {
      const u = new URL(String(raw || "").trim());
      const host = u.hostname.toLowerCase();
      if (host === "musinsa.onelink.me") return true;
      if (host === "www.musinsa.com" || host === "musinsa.com")
        return /^\/products\/\d+\/?$/.test(u.pathname);
      if (host.endsWith("starbucks.co.kr")) return true;
      return false;
    } catch {
      return false;
    }
  }

  function cloudSafeProduct(product) {
    const p = JSON.parse(JSON.stringify(product || {}));
    const remote = safeArray(p.remoteImages).filter((url) => /^https?:\/\//i.test(url));
    const httpImages = safeArray(p.images).filter((url) => /^https?:\/\//i.test(url));
    p.images = (remote.length ? remote : httpImages).slice(0, 5);
    if (remote.length) p.remoteImages = remote.slice(0, 5);
    delete p.downloadFolder;
    return p;
  }

  function cloudSafeData() {
    try {
      const clone = JSON.parse(JSON.stringify(data));
      clone.products = safeArray(clone.products).map(cloudSafeProduct);
      return clone;
    } catch (error) {
      console.error("[catalog-sync] cloudSafeData", error);
      return null;
    }
  }

  function normalizeIncomingData(incoming) {
    const next = JSON.parse(JSON.stringify(incoming || {}));
    next.products = safeArray(next.products).map((p) => {
      p.images = safeArray(p.images).filter((url) => /^https?:\/\//i.test(url));
      p.remoteImages = safeArray(p.remoteImages).filter((url) => /^https?:\/\//i.test(url));
      if (!p.images.length && p.remoteImages.length) p.images = p.remoteImages.slice(0, 5);
      return p;
    });
    return next;
  }

  function productFingerprint() {
    try {
      return JSON.stringify(
        safeArray(data.products).map((p) => [p.name, p.sale, p.source, p.updatedAt]),
      );
    } catch {
      return String(safeArray(data.products).length);
    }
  }

  function applyRemoteCatalog(incoming, stamp) {
    if (!incoming || typeof incoming !== "object") return;
    applyingRemote = true;
    try {
      const next = normalizeIncomingData(incoming);
      for (const key of Object.keys(data)) delete data[key];
      Object.assign(data, next);
      localStorage.setItem(KEY, JSON.stringify(data));
      localStorage.setItem(SYNC_STAMP_KEY, String(stamp || now()));
      if (typeof render === "function") render();
      renderQueue(latestQueue);
    } catch (error) {
      console.error("[catalog-sync] apply remote", error);
    } finally {
      applyingRemote = false;
    }
  }

  async function pushCatalog() {
    if (!initialized || applyingRemote || !ref) return;
    const catalogData = cloudSafeData();
    if (!catalogData) return;
    const stamp = now();
    try {
      await f.setDoc(
        ref,
        {
          internalWorkspace: true,
          catalogData,
          catalogUpdatedAt: stamp,
          lastWriter: deviceId,
          updatedAt: stamp,
        },
        { merge: true },
      );
      localStorage.setItem(SYNC_STAMP_KEY, String(stamp));
      updateSyncBadge("동기화됨", "ok");
    } catch (error) {
      console.error("[catalog-sync] push", error);
      updateSyncBadge("동기화 오류", "error");
    }
  }

  function scheduleCatalogPush() {
    if (!initialized || applyingRemote) return;
    clearTimeout(writeTimer);
    updateSyncBadge("동기화 중", "busy");
    writeTimer = setTimeout(pushCatalog, 450);
  }

  function installAutosaveHook() {
    if (typeof autosave !== "function" || autosave.__cloudWrapped) return;
    const original = autosave;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      scheduleCatalogPush();
      return result;
    };
    wrapped.__cloudWrapped = true;
    autosave = wrapped;
  }

  function ensureSyncUi() {
    if (document.getElementById("catalogSyncPanel")) return;
    const importSection = document.querySelector(".import");
    if (!importSection) return;
    const panel = document.createElement("section");
    panel.id = "catalogSyncPanel";
    panel.style.cssText = "margin:-4px 0 16px;padding:11px 13px;background:#fff;border:1px solid var(--line,#dfe5e1);border-radius:13px;font-size:12px;";
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;justify-content:space-between">
        <strong>기기 동기화</strong>
        <span id="catalogSyncBadge" style="color:#6a766f">연결 중</span>
      </div>
      <div id="catalogQueue" style="margin-top:8px;color:#6a766f"></div>`;
    importSection.insertAdjacentElement("afterend", panel);
  }

  function updateSyncBadge(text, state) {
    ensureSyncUi();
    const el = document.getElementById("catalogSyncBadge");
    if (!el) return;
    el.textContent = text;
    el.style.color = state === "error" ? "#b3261e" : state === "ok" ? "#00754a" : "#6a766f";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function shortUrl(url) {
    try {
      const u = new URL(url);
      return `${u.hostname}${u.pathname}`;
    } catch {
      return String(url || "");
    }
  }

  function renderQueue(queue) {
    ensureSyncUi();
    latestQueue = safeArray(queue);
    const box = document.getElementById("catalogQueue");
    if (!box) return;
    const active = latestQueue.filter((q) => q && q.status !== "done").slice(-5);
    if (!active.length) {
      box.innerHTML = isMobile
        ? "모바일에서 상품 링크를 넣으면 PC 작업목록으로 전달됩니다."
        : "모바일에서 전달된 상품 링크가 없습니다.";
      return;
    }
    box.innerHTML = active.map((q) => {
      const status = q.status === "processing" ? "처리 중" : q.status === "waiting" ? "PC 추출기 대기" : "대기";
      return `<div style="display:flex;gap:7px;align-items:center;padding:4px 0;border-top:1px solid #eef1ef"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#18201c">${escapeHtml(shortUrl(q.url))}</span><b style="font-size:10px;color:#00754a">${status}</b></div>`;
    }).join("");
  }

  async function mutateQueue(mutator) {
    if (!ref) throw new Error("동기화 연결 전입니다");
    return f.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists() ? safeArray(snap.data().pendingLinks) : [];
      const next = mutator(current.slice());
      tx.set(
        ref,
        { pendingLinks: next.slice(-40), updatedAt: now(), internalWorkspace: true },
        { merge: true },
      );
      return next;
    });
  }

  async function enqueueLink(url) {
    const clean = String(url || "").trim();
    if (!validProductLink(clean)) throw new Error("지원하지 않는 상품 링크입니다");
    const id = `${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await mutateQueue((queue) => {
      if (queue.some((item) => item && item.url === clean && item.status !== "done")) return queue;
      queue.push({ id, url: clean, status: "pending", createdAt: now(), createdBy: deviceId });
      return queue;
    });
  }

  async function setQueueStatus(id, status) {
    await mutateQueue((queue) => queue.map((item) =>
      item && item.id === id
        ? { ...item, status, statusAt: now(), handledBy: deviceId }
        : item,
    ));
  }

  function installMobileImportHook() {
    if (!isMobile) return;
    const button = document.getElementById("import");
    const input = document.querySelector(".import input");
    // The online importer owns supported mobile links. Keep the old queue only as
    // a compatibility fallback when that script genuinely failed to load.
    if (!button || !input || button.dataset.onlineImportHook === "1" || button.dataset.cloudQueueHook === "1") return;
    button.dataset.cloudQueueHook = "1";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const url = input.value.trim();
      if (!url) return toastSafe("상품 링크를 입력해주세요");
      if (!initialized) return toastSafe("기기 동기화 연결 중입니다. 다시 눌러주세요");
      button.disabled = true;
      const oldText = button.textContent;
      button.textContent = "PC로 전송 중…";
      try {
        await enqueueLink(url);
        input.value = "";
        toastSafe("상품 링크를 PC 작업목록에 추가했습니다");
      } catch (error) {
        toastSafe(error.message || "상품 링크를 전송하지 못했습니다");
      } finally {
        button.disabled = false;
        button.textContent = oldText;
      }
    }, true);
  }

  async function runExistingImporter(url) {
    const button = document.getElementById("import");
    const input = document.querySelector(".import input");
    if (!button || !input) return false;
    const before = productFingerprint();
    input.value = url;
    button.click();
    for (let i = 0; i < 180; i++) {
      await sleep(250);
      if (!button.disabled) break;
    }
    await sleep(100);
    return productFingerprint() !== before;
  }

  async function processPendingQueue(queue) {
    if (isMobile || queueBusy || !initialized) return;
    const pending = safeArray(queue).find((item) =>
      item && (item.status === "pending" || item.status === "waiting"),
    );
    if (!pending) return;
    queueBusy = true;
    try {
      await setQueueStatus(pending.id, "processing");
      const ok = await runExistingImporter(pending.url);
      if (ok) {
        await setQueueStatus(pending.id, "done");
        scheduleCatalogPush();
      } else {
        await setQueueStatus(pending.id, "waiting");
      }
    } catch (error) {
      console.error("[catalog-sync] queue processing", error);
      try { await setQueueStatus(pending.id, "waiting"); } catch {}
    } finally {
      queueBusy = false;
    }
  }

  async function init() {
    ensureSyncUi();
    installAutosaveHook();
    installMobileImportHook();

    try {
      const [{ initializeApp }, firestore] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"),
      ]);
      f = firestore;
      const app = initializeApp(FIREBASE_CONFIG, "catalog-workspace-sync");
      db = f.getFirestore(app);
      ref = f.doc(db, COLLECTION, WORKSPACE_ID);

      const first = await f.getDoc(ref);
      const cloud = first.exists() ? first.data() : null;
      const localStamp = Number(localStorage.getItem(SYNC_STAMP_KEY) || 0);
      const cloudStamp = Number(cloud?.catalogUpdatedAt || 0);
      const localCount = safeArray(data.products).length;
      const cloudCount = safeArray(cloud?.catalogData?.products).length;

      initialized = true;
      updateSyncBadge("연결됨", "ok");

      // First-sync safety:
      // 1) Never replace a non-empty local catalog with an empty cloud catalog.
      // 2) Empty local device adopts a non-empty cloud catalog.
      // 3) When both contain products, normal timestamp sync takes over.
      if (localCount > 0 && cloudCount === 0) {
        await pushCatalog();
      } else if (localCount === 0 && cloudCount > 0) {
        applyRemoteCatalog(cloud.catalogData, cloudStamp);
      } else if (localCount > 0 && cloudCount > 0) {
        if (cloudStamp > localStamp) applyRemoteCatalog(cloud.catalogData, cloudStamp);
        else await pushCatalog();
      } else if (!cloud?.catalogData) {
        await pushCatalog();
      }

      renderQueue(cloud?.pendingLinks || []);

      f.onSnapshot(ref, (snap) => {
        if (!snap.exists()) return;
        const remote = snap.data();
        const remoteStamp = Number(remote.catalogUpdatedAt || 0);
        const localKnown = Number(localStorage.getItem(SYNC_STAMP_KEY) || 0);
        renderQueue(remote.pendingLinks || []);
        if (remote.catalogData && remoteStamp > localKnown && remote.lastWriter !== deviceId) {
          const incomingCount = safeArray(remote.catalogData.products).length;
          const currentCount = safeArray(data.products).length;
          // Same protection also applies to live updates.
          if (!(currentCount > 0 && incomingCount === 0)) {
            applyRemoteCatalog(remote.catalogData, remoteStamp);
          }
        }
        processPendingQueue(remote.pendingLinks || []);
        updateSyncBadge("동기화됨", "ok");
      }, (error) => {
        console.error("[catalog-sync] snapshot", error);
        updateSyncBadge("동기화 오류", "error");
      });

      window.addEventListener("focus", () => processPendingQueue(latestQueue));
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) processPendingQueue(latestQueue);
      });
    } catch (error) {
      console.error("[catalog-sync] init", error);
      updateSyncBadge("연결 실패", "error");
      toastSafe("기기 동기화 연결에 실패했습니다");
    }
  }

  init();
})();
