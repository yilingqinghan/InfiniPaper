(function () {
    const q = (sel) => document.querySelector(sel);
  
    function getInput() {
      // 常见两类：textarea 或 contenteditable
      return q('textarea, [data-testid="textbox"], [contenteditable="true"]');
    }
  
    function typeText(el, text) {
      // 兼容 React 受控：触发 input 事件
      const setter = Object.getOwnPropertyDescriptor(el.__proto__ || Object.getPrototypeOf(el), "value")?.set;
      setter ? setter.call(el, text) : (el.value = text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  
    function clickSend() {
      // 发送按钮（不同 UI 下 data-testid 可能不同）
      const btn =
        q('button[data-testid="send-button"]') ||
        q('form button[type="submit"]') ||
        [...document.querySelectorAll("button")].find(b => /send|发送/i.test(b.textContent || ""));
      if (btn) btn.click();
    }
  
    async function ensureReady() {
      // 输入框可能还没渲染完，轮询一下
      for (let i = 0; i < 40; i++) {
        const el = getInput();
        if (el) return el;
        await new Promise(r => setTimeout(r, 150));
      }
      return null;
    }
  
    window.addEventListener("ASK_CHATGPT_BRIDGE", async () => {
      const payload = window.__ASK_CHATGPT_PAYLOAD__ || {};
      const text = String(payload.text || "").trim();
      if (!text) return;
  
      const el = await ensureReady();
      if (!el) return;
  
      // 若已有内容则换行追加
      const current = el.value || el.textContent || "";
      const finalText = current ? `${current}\n\n${text}` : text;
  
      typeText(el, finalText);
      el.focus();
      // 自动发送
      clickSend();
    });
  })();