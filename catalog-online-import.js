/*
STARBUCKS HELPER
File : catalog-online-import.js
Version : 1.1
Updated : 2026-09-04
Purpose : Mobile-first online Musinsa import through Vercel API.

- Runs before catalog-sync.js so mobile import does not fall into the PC queue.
- Keeps the existing editor data shape and calculation functions.
- PC behavior is untouched.
*/
(() => {
  if (window.__starbucksCatalogOnlineImportLoaded) return;
  window.__starbucksCatalogOnlineImportLoaded = true;

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile) return;

  const API = "https://starbucks-helper.vercel.app/api/extract";

  function toastSafe(message) {
    try {
      if (typeof toast === "function") return toast(message);
    } catch {}
    alert(message);
  }

  function validMusinsaLink(raw) {
    try {
      const u = new URL(String(raw || "").trim());
      const host = u.hostname.toLowerCase();
      if (host === "musinsa.onelink.me") return true;
      return (host === "www.musinsa.com" || host === "musinsa.com") && /^\/products\/\d+\/?$/.test(u.pathname);
    } catch {
      return false;
    }
  }

  async function extractOnline(url) {
    let response;
    try {
      response = await fetch(API, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
    } catch {
      throw new Error("온라인 추출 서버에 연결하지 못했습니다");
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("온라인 추출 서버 응답을 읽지 못했습니다");
    }

    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || "무신사 상품을 가져오지 못했습니다");
    }
    if (!Array.isArray(result.imageUrls) || !result.imageUrls.length) {
      throw new Error("상품 이미지를 찾지 못했습니다");
    }
    return result;
  }

  function addImportedProduct(result) {
    const category = activeCategory === "전체" ? data.categories[0] || "" : activeCategory;
    const sale = Number(result.price || 0);
    const cost = calcCost(sale, category);
    const offer = calcOffer(cost);
    const images = (result.imageUrls || []).slice(0, 5);

    data.products.push({
      id: Date.now(),
      updatedAt: Date.now(),
      name: cleanProductName(result.productName),
      sale,
      cost,
      offer,
      images,
      remoteImages: images.slice(),
      current: 0,
      qty: 1,
      selected: false,
      source: result.source === "musinsa" ? "무신사" : "스타벅스 공식",
      downloadFolder: result.folder,
      category,
      tags: activeTag === "전체" ? [] : [activeTag],
    });
    autosave();
    render();
  }

  function install() {
    const button = document.getElementById("import");
    const input = document.querySelector(".import input");
    if (!button || !input || button.dataset.onlineImportHook === "1") return;

    button.dataset.onlineImportHook = "1";
    button.addEventListener("click", async (event) => {
      const url = input.value.trim();
      if (!validMusinsaLink(url)) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = "온라인 추출 중…";
      try {
        const result = await extractOnline(url);
        addImportedProduct(result);
        input.value = "";
        toastSafe(`상품을 추가했습니다 · 이미지 ${result.imageUrls.length}장`);
      } catch (error) {
        console.error("[catalog-online-import]", error);
        toastSafe(error?.message || "상품을 가져오지 못했습니다");
      } finally {
        button.disabled = false;
        button.textContent = oldText;
      }
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
