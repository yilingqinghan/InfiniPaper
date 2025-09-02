// 方式A：接受 window.postMessage
window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const data = e.data || {};
    if (data.source === "InfiniPaper" && data.type === "ASK_CHATGPT" && data.text) {
      chrome.runtime.sendMessage({ type: "ASK_CHATGPT", text: data.text });
    }
  });
  
  // 方式B：接受自定义事件（更不易冲突）
  window.addEventListener("INFINIPAPER_ASK_CHATGPT", (e) => {
    const text = e?.detail?.text;
    if (text) chrome.runtime.sendMessage({ type: "ASK_CHATGPT", text });
  });