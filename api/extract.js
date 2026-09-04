// STARBUCKS HELPER online extractor v1.1 (2026-09-04)
// Vercel serverless function. Returns product metadata only; PC-local file saving remains in local-md-helper.py.
// v1.1: Musinsa gallery fallback also collects product-specific prd_img images.

const ALLOWED_ORIGIN = "https://runipokr-dotcom.github.io";
const MUSINSA_HOSTS = new Set(["musinsa.com", "www.musinsa.com"]);
const MUSINSA_SHORT_HOST = "musinsa.onelink.me";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

function send(res, status, body) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

function extractBalanced(source, marker, opener, closer) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error("상품 데이터 구조를 찾을 수 없습니다.");
  const start = source.indexOf(opener, markerIndex + marker.length);
  if (start < 0) throw new Error("상품 데이터 시작점을 찾을 수 없습니다.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("상품 데이터 끝점을 찾을 수 없습니다.");
}

function musinsaLargeImage(path) {
  if (!path) return "";
  path = String(path).replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  if (path.startsWith("//")) path = "https:" + path;
  else if (path.startsWith("/")) path = "https://image.msscdn.net/thumbnails" + path;
  if (!path.startsWith("https://image.msscdn.net/")) return "";
  path = path.replace(/_500(?=\.(?:jpe?g|png|webp)$)/i, "_big");
  return path + (path.includes("?") ? "&" : "?") + "w=1200";
}

function collectMusinsaGalleryFallback(html, productId) {
  if (!productId) return [];
  const normalized = String(html || "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
  const escapedId = String(productId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `https://image\\.msscdn\\.net/thumbnails/images/(?:goods_img|prd_img)/[^"'<>\\s]+/${escapedId}/[^"'<>\\s]+?\\.(?:jpe?g|png|webp)`,
    "gi",
  );
  const out = [];
  for (const match of normalized.matchAll(pattern)) {
    const image = musinsaLargeImage(match[0].replace(/[),;]+$/, ""));
    if (image && !out.includes(image)) out.push(image);
    if (out.length >= 5) break;
  }
  return out;
}

function parseMusinsaProduct(html, sourceUrl = "") {
  const state = JSON.parse(extractBalanced(html, "window.__MSS_FE__.product.state", "{", "}"));
  const name = String(state.goodsNm || "").trim();
  const priceData = state.goodsPrice && typeof state.goodsPrice === "object" ? state.goodsPrice : {};
  const price = Number(priceData.salePrice || priceData.normalPrice || 0);
  const brand = state.brandInfo && typeof state.brandInfo === "object" ? state.brandInfo : {};
  const description = String(state.headDesc || brand.memo || "").trim();
  const candidates = [String(state.thumbnailImageUrl || "")];
  for (const item of Array.isArray(state.goodsImages) ? state.goodsImages : []) {
    if (item && typeof item === "object") candidates.push(String(item.imageUrl || ""));
  }
  const productId = String(state.goodsNo || "").trim() || String(sourceUrl).match(/\/products\/(\d+)/)?.[1] || "";
  candidates.push(...collectMusinsaGalleryFallback(html, productId));

  const images = [];
  for (const candidate of candidates) {
    const image = musinsaLargeImage(candidate);
    if (image && !images.includes(image)) images.push(image);
    if (images.length >= 5) break;
  }
  if (!name) throw new Error("무신사 상품명을 찾을 수 없습니다.");
  if (!images.length) throw new Error("무신사 상품 갤러리 이미지를 찾을 수 없습니다.");
  return { productName: name, description, price, imageUrls: images, source: "musinsa" };
}

function parseStarbucksProduct(html) {
  const view = JSON.parse(extractBalanced(html, "view: remapView", "{", "}"));
  const files = JSON.parse(extractBalanced(html, "file: remapFile", "[", "]"));
  const name = String(view.PRODUCT_NM || "").trim();
  const description = String(view.RECOMMEND || "").replace(/\\r\\n/g, "\n").trim();
  if (!name) throw new Error("상품명을 찾을 수 없습니다.");
  const ordered = [...files].sort((a, b) => Number(a.IMG_ORDER || 999999) - Number(b.IMG_ORDER || 999999));
  const images = [];
  for (const item of ordered) {
    const path = String(item.FILE_PATH || "").trim();
    const base = String(item.IMG_UPLOAD_PATH || "https://image.istarbucks.co.kr").trim();
    if (!path) continue;
    const url = new URL(path.replace(/^\/+/, ""), base.replace(/\/?$/, "/")).toString();
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "image.istarbucks.co.kr") continue;
    if (!parsed.pathname.includes("/upload/store/skuimg/")) continue;
    if (!images.includes(url)) images.push(url);
  }
  if (!images.length) throw new Error("상품 원본 이미지를 찾을 수 없습니다.");
  return { productName: name, description, price: 0, imageUrls: images.slice(0, 5), source: "starbucks" };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`상품 페이지 응답 오류: HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length && length > MAX_PAGE_BYTES) throw new Error("상품 페이지가 허용 크기를 초과했습니다.");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_PAGE_BYTES) throw new Error("상품 페이지가 허용 크기를 초과했습니다.");
    return { text, finalUrl: response.url };
  } finally {
    clearTimeout(timer);
  }
}

async function normalizeUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || "").trim());
  } catch {
    throw new Error("올바른 URL을 입력해주세요.");
  }
  if (parsed.protocol !== "https:") throw new Error("HTTPS 상품 주소를 입력해주세요.");

  if (parsed.hostname === MUSINSA_SHORT_HOST) {
    if (!/^\/PvkC\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname)) throw new Error("무신사 공유링크 형식이 아닙니다.");
    const resolved = await fetchText(parsed.toString());
    parsed = new URL(resolved.finalUrl);
    if (!MUSINSA_HOSTS.has(parsed.hostname)) throw new Error("무신사 공유링크의 실제 상품주소를 확인할 수 없습니다.");
  }

  if (MUSINSA_HOSTS.has(parsed.hostname)) {
    const m = parsed.pathname.match(/^\/products\/(\d+)\/?$/);
    if (!m) throw new Error("무신사 상품 상세페이지 URL 형식이 아닙니다.");
    return { source: "musinsa", url: `https://www.musinsa.com/products/${m[1]}` };
  }

  if (parsed.hostname === "www.starbucks.co.kr") {
    if (parsed.pathname !== "/menu/product_view.do") throw new Error("스타벅스 상품 상세페이지 URL 형식이 아닙니다.");
    const code = parsed.searchParams.get("product_cd");
    if (!/^\d+$/.test(code || "")) throw new Error("URL의 product_cd를 확인해주세요.");
    return { source: "starbucks", url: parsed.toString() };
  }

  throw new Error("스타벅스 공식 홈페이지 또는 무신사 상품 주소만 사용할 수 있습니다.");
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "POST 요청만 지원합니다." });

  try {
    const { url } = req.body || {};
    const normalized = await normalizeUrl(url);
    const page = await fetchText(normalized.url);
    const result = normalized.source === "musinsa"
      ? parseMusinsaProduct(page.text, normalized.url)
      : parseStarbucksProduct(page.text);
    send(res, 200, {
      ok: true,
      ...result,
      mediaUrls: result.imageUrls,
      imageCount: result.imageUrls.length,
      sourceUrl: normalized.url,
      online: true,
    });
  } catch (error) {
    console.error(error);
    send(res, 400, { ok: false, error: error?.message || "상품을 가져오지 못했습니다." });
  }
}