// Background service worker for PasteNote
chrome.runtime.onInstalled.addListener(() => {
  console.log('PasteNote extension installed');
});

// Handle storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.memos_notes) {
    console.log('Notes updated:', changes.memos_notes.newValue.length, 'notes');
  }
});

// 监听标签页激活变化
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url) {
      // 发送消息给侧边栏，通知标签页已切换
      chrome.runtime.sendMessage({
        type: 'tabChanged',
        url: tab.url,
        title: tab.title
      }).catch(() => {
        // 如果侧边栏没有打开，忽略错误
      });
    }
  });
});

// 监听标签页 URL 变化
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active && tab.url) {
    // 发送消息给侧边栏，通知页面已更新
    chrome.runtime.sendMessage({
      type: 'tabUpdated',
      url: tab.url,
      title: tab.title
    }).catch(() => {
      // 如果侧边栏没有打开，忽略错误
    });
  }
});