(() => {
  window.StarbucksHelperPinPad = function ({ onComplete, onExit }) {
    const root = document.createElement("div");
    root.id = "helperPinGate";
    root.innerHTML = `
      <style>
        #helperPinGate{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#063c2d;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        #helperPinGate *{box-sizing:border-box}
        #helperPinGate .wrap{width:min(100%,360px);padding:28px;text-align:center}
        #helperPinGate h1{margin:0 0 8px;font-size:24px}
        #helperPinGate p{margin:0 0 24px;color:#ffffffb8;font-size:13px}
        #helperPinGate .dots{display:flex;justify-content:center;gap:14px;margin-bottom:24px}
        #helperPinGate .dot{width:14px;height:14px;border:2px solid #ffffffb8;border-radius:50%}
        #helperPinGate .dot.on{background:#fff}
        #helperPinGate .keys{display:grid;grid-template-columns:repeat(3,72px);justify-content:center;gap:14px}
        #helperPinGate button.key{width:72px;height:72px;border:1px solid #ffffff38;border-radius:50%;background:#ffffff10;color:#fff;font-size:27px;font-weight:700}
        #helperPinGate button.key:active{transform:scale(.96);background:#ffffff20}
        #helperPinGate .msg{min-height:20px;margin:0 0 14px;color:#ffd0d0;font-size:12px}
        #helperPinGate .exit{margin-top:20px;border:0;background:transparent;color:#ffffff9e;text-decoration:underline;font:inherit;font-size:12px}
        #helperPinGate.shake .wrap{animation:helperPinShake .28s linear}
        @keyframes helperPinShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}
      </style>
      <div class="wrap">
        <h1>STARBUCKS HELPER</h1>
        <p>6자리 비밀번호를 입력하세요.</p>
        <div class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
        <div class="msg"></div>
        <div class="keys"></div>
        <button class="exit" type="button">상품 카탈로그로 이동</button>
      </div>`;

    let pin = "";
    const dots = [...root.querySelectorAll(".dot")];
    const keys = root.querySelector(".keys");
    const msg = root.querySelector(".msg");
    const redraw = () => dots.forEach((dot, i) => dot.classList.toggle("on", i < pin.length));

    const press = value => {
      if (value === "back") pin = pin.slice(0, -1);
      else if (pin.length < 6) pin += value;
      redraw();
      if (pin.length === 6) onComplete(pin, {
        fail(text) {
          msg.textContent = text || "비밀번호가 맞지 않습니다.";
          root.classList.remove("shake");
          void root.offsetWidth;
          root.classList.add("shake");
          pin = "";
          redraw();
        },
        close() { root.remove(); }
      });
    };

    ["1","2","3","4","5","6","7","8","9","","0","back"].forEach(value => {
      if (!value) { keys.appendChild(document.createElement("span")); return; }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "key";
      button.textContent = value === "back" ? "⌫" : value;
      button.onclick = () => press(value);
      keys.appendChild(button);
    });

    root.querySelector(".exit").onclick = onExit;
    document.body.appendChild(root);
  };
})();