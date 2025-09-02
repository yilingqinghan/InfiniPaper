// 创建/寻找 ChatGPT 标签
async function getChatGPTTab() {
    const tabs = await chrome.tabs.query({ url: "https://chat.openai.com/*" });
    if (tabs.length) {
      // 选择最近使用的那个
      tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      return tabs[0];
    }
    return await chrome.tabs.create({ url: "https://chat.openai.com/" });
  }
  
  // 往 ChatGPT 注入发送逻辑，并执行
  async function sendToChatGPT(text) {
    const tab = await getChatGPTTab();
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  
    // 先注入发送脚本（幂等）
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["inject-chatgpt.js"] });
  
    // 再把 payload 发进去执行
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (payload) => {
        window.__ASK_CHATGPT_PAYLOAD__ = payload;
        window.dispatchEvent(new CustomEvent("ASK_CHATGPT_BRIDGE"));
      },
      args: [{ text }]
    });
  }
  
  // 接收来自 content-bridge 的消息
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      if (msg?.type === "ASK_CHATGPT" && msg.text) {
        try {
          await sendToChatGPT(msg.text);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      }
    })();
    return true; // 异步响应
  });