/*
STARBUCKS HELPER internal access gate
Updated: 2026-09-25
Public exception: share.html (not loaded there)
Note: static GitHub Pages gate for casual access control, not a substitute for server-side authentication.
*/
(() => {
  if (!document.querySelector('script[data-helper-pin]')) { const s=document.createElement("script"); s.src="pin-pad.js?v=20260925-1"; s.dataset.helperPin="1"; document.head.appendChild(s); }
  const SESSION_KEY = "starbucks-helper-internal-auth-v1";
  const EXPECTED = "937377f056160fc4b15e0b770c67136a5f03c15205b4d3bf918268fefa2c6d0a";
  const PUBLIC_FALLBACK = "share.html?id=c6xxh9";

  if (sessionStorage.getItem(SESSION_KEY) === "ok") return;

  function sha256(ascii) {
    const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
    const maxWord = Math.pow(2, 32);
    let result = "";
    const words = [];
    const asciiBitLength = ascii.length * 8;
    let hash = sha256.h = sha256.h || [];
    const k = sha256.k = sha256.k || [];
    let primeCounter = k.length;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += "\x80";
    while (ascii.length % 64 - 56) ascii += "\x00";
    for (let i = 0; i < ascii.length; i++) {
      const j = ascii.charCodeAt(i);
      if (j >> 8) return "";
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = asciiBitLength;
    for (let j = 0; j < words.length;) {
      const w = words.slice(j, j += 16);
      const oldHash = hash.slice(0);
      hash = hash.slice(0, 8);
      for (let i = 0; i < 64; i++) {
        const i2 = i + j;
        let w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = i < 16 ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
        const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
        hash.pop();
      }
      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (let i = 0; i < 8; i++) {
      for (let j = 3; j + 1; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? "0" : "") + b.toString(16);
      }
    }
    return result;
  }

  let attempts = 0;
  function openPinPad() {
    if (!window.StarbucksHelperPinPad) {
      setTimeout(openPinPad, 30);
      return;
    }
    window.StarbucksHelperPinPad({
      onComplete(entered, ui) {
        if (sha256(entered) === EXPECTED) {
          sessionStorage.setItem(SESSION_KEY, "ok");
          ui.close();
          location.reload();
          return;
        }
        attempts++;
        if (attempts >= 3) {
          location.replace(PUBLIC_FALLBACK);
          return;
        }
        ui.fail("비밀번호가 맞지 않습니다.");
      },
      onExit() { location.replace(PUBLIC_FALLBACK); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", openPinPad, { once: true });
  else openPinPad();
})();
