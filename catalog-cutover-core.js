import { normalizeForManifest, sha256Hex } from "./catalog-backup-core.js";

export const PUBLIC_SHARE_ID = "c6xxh9";
export const LEGACY_WORKSPACE_ID = "work-k4m8q2x7n9v3c6p5r8t1";
export const EXPECTED_WORKSPACE_HASH = "bd5cc521b33c339510ee320c8f83bad00942b2bfae5255e421be5abea77dd40f";
export const EXPECTED_PRODUCT_COUNT = 286;
export const EXPECTED_CATEGORY_COUNT = 10;

const LIMITS = Object.freeze({
  category: 200,
  tag: 200,
  name: 500,
  imageUrl: 8192,
  notice: 500,
});

function scalarString(value, label, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== "string") throw new Error(`${label}: 문자열 형식 오류`);
  if ((!allowEmpty && !value.trim()) || value.length > maxLength) {
    throw new Error(`${label}: 길이 오류`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}: 0 이상의 유한 숫자가 아님`);
  }
  return value;
}

function isPrivateImageHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (/^192\.168\./.test(host)) return true;
  return /^(?:fc|fd|fe8|fe9|fea|feb)/.test(host) || host.startsWith("::ffff:");
}

function imageUrl(value, label) {
  const source = scalarString(value, label, LIMITS.imageUrl);
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error(`${label}: URL 형식 오류`);
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || isPrivateImageHost(parsed.hostname)) {
    throw new Error(`${label}: 공개 HTTP(S) URL이 아님`);
  }
  return source;
}

function publicImages(product, productIndex) {
  const source = Array.isArray(product.remoteImages) && product.remoteImages.length
    ? product.remoteImages
    : product.images;
  if (!Array.isArray(source)) throw new Error(`상품 #${productIndex + 1} 이미지: 배열 형식 오류`);
  const images = [];
  const seen = new Set();
  for (const value of source) {
    const url = imageUrl(value, `상품 #${productIndex + 1} 이미지`);
    if (!seen.has(url)) {
      seen.add(url);
      if (images.length < 5) images.push(url);
    }
  }
  return images;
}

export function workspaceCatalogData(workspace) {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    throw new Error("workspace 문서 형식 오류");
  }
  const catalogData = workspace.catalogData;
  if (!catalogData || typeof catalogData !== "object" || Array.isArray(catalogData)) {
    throw new Error("workspace catalogData 형식 오류");
  }
  if (!Array.isArray(catalogData.products) || catalogData.products.length !== EXPECTED_PRODUCT_COUNT) {
    throw new Error("workspace 상품 수 불일치");
  }
  if (!Array.isArray(catalogData.categories) || catalogData.categories.length !== EXPECTED_CATEGORY_COUNT) {
    throw new Error("workspace 카테고리 수 불일치");
  }
  return catalogData;
}

export async function verifyWorkspace(workspace) {
  const catalogData = workspaceCatalogData(workspace);
  const hash = await sha256Hex(normalizeForManifest(workspace));
  if (hash !== EXPECTED_WORKSPACE_HASH) {
    throw new Error("verified 백업 이후 workspace hash가 변경되었습니다. 새 백업이 필요합니다.");
  }
  return {
    hash,
    productCount: catalogData.products.length,
    categoryCount: catalogData.categories.length,
  };
}

export function buildSaleOnlyProjection(workspace, updatedAt = Date.now()) {
  const source = workspaceCatalogData(workspace);
  if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) throw new Error("게시 시각 형식 오류");
  const categories = source.categories.map((category, index) =>
    scalarString(category, `카테고리 #${index + 1}`, LIMITS.category),
  );
  const notice = source.shareNotice == null
    ? ""
    : scalarString(source.shareNotice, "공개 안내문", LIMITS.notice, { allowEmpty: true }).trim();
  const products = source.products.map((product, index) => {
    if (!product || typeof product !== "object" || Array.isArray(product)) {
      throw new Error(`상품 #${index + 1}: 객체 형식 오류`);
    }
    if (!Number.isSafeInteger(product.id) || product.id <= 0) {
      throw new Error(`상품 #${index + 1}: ID 형식 오류`);
    }
    const productUpdatedAt = product.updatedAt == null ? product.id : product.updatedAt;
    if (!Number.isSafeInteger(productUpdatedAt) || productUpdatedAt <= 0) {
      throw new Error(`상품 #${index + 1}: 수정시각 형식 오류`);
    }
    if (!Array.isArray(product.tags)) throw new Error(`상품 #${index + 1}: 태그 배열 오류`);
    return {
      id: product.id,
      name: scalarString(product.name, `상품 #${index + 1} 이름`, LIMITS.name),
      sale: finiteNumber(product.sale, `상품 #${index + 1} 판매가`),
      category: scalarString(
        product.category,
        `상품 #${index + 1} 카테고리`,
        LIMITS.category,
        { allowEmpty: true },
      ),
      tags: product.tags.map((tag, tagIndex) =>
        scalarString(tag, `상품 #${index + 1} 태그 #${tagIndex + 1}`, LIMITS.tag),
      ),
      images: publicImages(product, index),
      updatedAt: productUpdatedAt,
    };
  });
  return { categories, notice, products, updatedAt };
}

export function projectionSummary(projection) {
  const products = Array.isArray(projection?.products) ? projection.products : [];
  return {
    productCount: products.length,
    categoryCount: Array.isArray(projection?.categories) ? projection.categories.length : null,
    offerCount: products.filter((product) => Object.hasOwn(product, "offer")).length,
  };
}
