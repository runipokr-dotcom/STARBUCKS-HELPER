/*
STARBUCKS HELPER
File : catalog-sync.js
Version : 1.3
Updated : 2026-09-04
Purpose : Cross-device catalog sync + mobile link queue + category-priority sorting + source image repair.

- PC keeps the existing localhost extractor.
- Mobile sends product links to a shared Firestore queue instead of localhost.
- PC processes queued links through the existing import button.
- Product metadata is mirrored so PC/mobile see the same catalog.
- First sync protects an existing non-empty local catalog from an empty cloud copy.
- Catalog order is grouped by category priority before price/added/updated sorting.
- Image recheck uses each product sourceUrl and only fills missing source images.
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
  const IMAGE_RECHECK_API = "https://starbucks-helper.vercel.app/api/extract";
  const CATEGORY_PRIORITY = [
    "텀블러/보온병",
    "머그",
    "액세서리",
    "티바나(차)",
    "시럽",
    "우산",
    "비아",
    "원두",
    "리유저블",
  ];
  const CATEGORY_ALIASES = new Map([
    ["텀블러", "텀블러/보온병"],
    ["악세사리", "액세서리"],
    ["악세서리", "액세서리"],
    ["티바나", "티바나(차)"],
  ]);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  let f = null;
  let db = null;
  let ref = null;
  let initialized = false;
  let applyingRemote = false;
  let writeTimer = null;
  let queueBusy = false;
  let imageRecheckBusy = false;
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
  const normalizeCategoryName = (value) => {
    const name = String(value || "").trim();
    return CATEGORY_ALIASES.get(name) || name;
  };
  const categoryRank = (category) => {
    const index = CATEGORY_PRIORITY.indexOf(normalizeCategoryName(category));
    return index === -1 ? CATEGORY_PRIORITY.length : index;
  };

  function normalizeCatalogCategories(target) {
    if (!target || typeof target !== "object") return target;

    const existing = safeArray(target.categories)
      .map(normalizeCategoryName)
      .filter(Boolean);
    const extras = existing.filter((category) => !CATEGORY_PRIORITY.includes(category));
    target.categories = [...new Set([...CATEGORY_PRIORITY, ...extras])];

    target.products = safeArray(target.products).map((product) => {
      product.category = normalizeCategoryName(product.category);
      if (!product.category) product.category = target.categories[0] || "";
      return product;
    });

    target.tumblerCategories = safeArray(target.tumblerCategories)
      .map(normalizeCategoryName)
      .filter(Boolean);
    if (!target.tumblerCategories.includes("텀블러/보온병"))
      target.tumblerCategories.push("텀블러/보온병");
    target.tumblerCategories = [...new Set(target.tumblerCategories)];

    return target;
  }

  function applyCategoryPriorityOrder() {
    if (!data || !Array.isArray(data.products) || data.products.length < 2) return;
    data.products = data.products
      .map((product, index) => ({ product, index }))
      .sort((a, b) => categoryRank(a.product.category) - categoryRank(b.product.category) || a.index - b.index)
      .map(({ product }) => product);
  }

  function installPrioritySortHook() {
    if (typeof sortProducts !== "function" || sortProducts.__categoryPriorityWrapped) return;
    const wrapped = function (mode) {
      normalizeCatalogCategories(data);
      const keyFn =
        mode === "price"
          ? (p) => Number(p.offer || 0)
          : mode === "added"
            ? (p) => Number(p.id || 0)
            : (p) => Number(p.updatedAt || p.id || 0);

      data.products = data.products
        .map((product, index) => ({ product, index }))
        .sort((a, b) => {
          const categoryDiff = categoryRank(a.product.category) - categoryRank(b.product.category);
          if (categoryDiff) return categoryDiff;
          const keyDiff = keyFn(b.product) - keyFn(a.product);
          return keyDiff || a.index - b.index;
        })
        .map(({ product }) => product);

      autosave();
      render();
      toastSafe("카테고리 우선순위로 정렬했습니다");
    };
    wrapped.__categoryPriorityWrapped = true;
    sortProducts = wrapped;
  }

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
      const clone = normalizeCatalogCategories(JSON.parse(JSON.stringify(data)));
      clone.products = safeArray(clone.products).map(cloudSafeProduct);
      return clone;
    } catch (error) {
      console.error("[catalog-sync] cloudSafeData", error);
      return null;
    }
  }

  function normalizeIncomingData(incoming) {
    const next = normalizeCatalogCategories(JSON.parse(JSON.stringify(incoming || {})));
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
      applyCategoryPriorityOrder();
      if (typeof applyPricingRules === "function") applyPricingRules(data.products);
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
      <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap">
        <strong>기기 동기화</strong>
        <div style="display:flex;align-items:center;gap:7px">
          <button id="catalogImageRecheck" class="btn filter-btn" type="button" style="padding:6px 9px">이미지 재검수</button>
          <span id="catalogSyncBadge" style="color:#6a766f">연결 중</span>
        </div>
      </div>
      <div id="catalogImageRecheckStatus" style="margin-top:7px;color:#6a766f"></div>
      <div id="catalogQueue" style="margin-top:8px;color:#6a766f"></div>`;
    importSection.insertAdjacentElement("afterend", panel);
    document.getElementById("catalogImageRecheck")?.addEventListener("click", recheckCatalogImages);
  }

  function updateSyncBadge(text, state) {
    ensureSyncUi();
    const el = document.getElementById("catalogSyncBadge");
    if (!el) return;
    el.textContent = text;
    el.style.color = state === "error" ? "#b3261e" : state === "ok" ? "#00754a" : "#6a766f";
  }

  function updateImageRecheckStatus(text) {
    ensureSyncUi();
    const el = document.getElementById("catalogImageRecheckStatus");
    if (el) el.textContent = text || "";
  }

  function canonicalSourceKey(url) {
    try {
      const u = new URL(String(url || "").trim());
      if (u.hostname === "www.musinsa.com" || u.hostname === "musinsa.com") {
        const id = u.pathname.match(/^\/products\/(\d+)\/?$/)?.[1];
        return id ? `musinsa:${id}` : "";
      }
      if (u.hostname === "www.starbucks.co.kr" && ["/menu/product_view.do", "/menu/food_view.do"].includes(u.pathname)) {
        const code = u.searchParams.get("product_cd");
        const type = u.pathname === "/menu/food_view.do" ? "food" : "product";
        return code ? `starbucks:${type}:${code}` : "";
      }
    } catch {}
    return "";
  }

  function cleanNameForMatch(value) {
    try {
      if (typeof cleanProductName === "function") return cleanProductName(value).toLowerCase();
    } catch {}
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  async function fetchSourceProduct(url) {
    const response = await fetch(IMAGE_RECHECK_API, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("추출 서버 응답 오류");
    }
    if (!response.ok || !result?.ok) throw new Error(result?.error || "원본 재추출 실패");
    return result;
  }

  function sourceResultMatches(product, result) {
    const expectedKey = canonicalSourceKey(product.sourceUrl);
    const resultKey = canonicalSourceKey(result.sourceUrl);
    if (expectedKey && resultKey) return expectedKey === resultKey;
    const sameName = cleanNameForMatch(product.name) === cleanNameForMatch(result.productName);
    if (!sameName) return false;
    const resultPrice = Number(result.price || 0);
    return !resultPrice || !Number(product.sale || 0) || resultPrice === Number(product.sale || 0);
  }

  function mergeSourceImages(product, fetchedImages) {
    const remote = [...new Set(safeArray(fetchedImages).filter((url) => /^https?:\/\//i.test(url)))].slice(0, 5);
    if (!remote.length) return false;
    const currentRemote = safeArray(product.remoteImages).filter((url) => /^https?:\/\//i.test(url));
    const mergedRemote = [...new Set([...remote, ...currentRemote])].slice(0, 5);
    const manualLocal = safeArray(product.images).filter((url) => !/^https?:\/\//i.test(url));
    const nextImages = [...manualLocal, ...mergedRemote].slice(0, 5);
    const beforeRemote = JSON.stringify(currentRemote.slice(0, 5));
    const beforeImages = JSON.stringify(safeArray(product.images).slice(0, 5));
    product.remoteImages = mergedRemote;
    product.images = nextImages;
    product.current = Math.min(Number(product.current || 0), Math.max(0, nextImages.length - 1));
    return beforeRemote !== JSON.stringify(mergedRemote) || beforeImages !== JSON.stringify(nextImages);
  }

  async function recheckCatalogImages() {
    if (imageRecheckBusy) return;
    const button = document.getElementById("catalogImageRecheck");
    const targets = safeArray(data.products).filter((p) => validProductLink(p.sourceUrl));
    const skipped = safeArray(data.products).length - targets.length;
    if (!targets.length) return toastSafe("원본 링크가 저장된 상품이 없습니다");

    imageRecheckBusy = true;
    if (button) button.disabled = true;
    let checked = 0;
    let repaired = 0;
    let unchanged = 0;
    let mismatch = 0;
    let failed = 0;

    try {
      for (const product of targets) {
        checked++;
        updateImageRecheckStatus(`이미지 재검수 ${checked}/${targets.length} · ${product.name}`);
        try {
          const result = await fetchSourceProduct(product.sourceUrl);
          if (!sourceResultMatches(product, result)) {
            mismatch++;
            continue;
          }
          if (mergeSourceImages(product, result.imageUrls)) repaired++;
          else unchanged++;
        } catch (error) {
          failed++;
          console.warn("[catalog-sync] image recheck", product.name, error);
        }
        if (checked < targets.length) await sleep(80);
      }

      if (repaired) {
        localStorage.setItem(KEY, JSON.stringify(data));
        if (typeof render === "function") render();
        scheduleCatalogPush();
      }
      const summary = `완료 · 검사 ${checked} · 보강 ${repaired} · 정상 ${unchanged} · 매칭불일치 ${mismatch} · 실패 ${failed}${skipped ? ` · 원본링크없음 ${skipped}` : ""}`;
      updateImageRecheckStatus(summary);
      toastSafe(summary);
    } finally {
      imageRecheckBusy = false;
      if (button) button.disabled = false;
    }
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
    normalizeCatalogCategories(data);
    applyCategoryPriorityOrder();
    localStorage.setItem(KEY, JSON.stringify(data));
    if (typeof render === "function") render();
    installPrioritySortHook();
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
