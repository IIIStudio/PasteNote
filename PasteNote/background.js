// Background service worker for PasteNote
chrome.runtime.onInstalled.addListener(() => {
  console.log('PasteNote extension installed');

// 创建右键菜单 - 主菜单
chrome.contextMenus.create({
  id: 'pastenote-menu',
  title: 'PasteNote - 插入笔记',
  contexts: ['editable']
});

// 创建分类子菜单项（动态生成会在点击时处理）
});

// 处理图标点击打开/关闭侧边栏
const sidePanelStates = {};

chrome.action.onClicked.addListener(async (tab) => {
  console.log('Extension icon clicked, toggling side panel');
  try {
    const tabId = tab.id;
    
    // 检查当前标签页的侧边栏是否已打开
    const isOpen = sidePanelStates[tabId] === true;
    
    if (isOpen) {
      // 如果已打开，则关闭侧边栏
      await chrome.sidePanel.close({ tabId: tabId });
      sidePanelStates[tabId] = false;
      console.log('Side panel closed');
    } else {
      // 如果未打开，则打开侧边栏
      await chrome.sidePanel.open({ tabId: tabId });
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        path: 'sidebar.html'
      });
      sidePanelStates[tabId] = true;
      console.log('Side panel opened');
    }
  } catch (error) {
    console.error('Failed to toggle side panel:', error);
  }
});

// 监听侧边栏关闭事件，清理状态
chrome.sidePanel.onClosed.addListener(({ tabId }) => {
  sidePanelStates[tabId] = false;
  console.log('Side panel closed (detected by event), tabId:', tabId);
});

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log('右键菜单被点击:', info.menuItemId);
  if (info.menuItemId === 'pastenote-menu') {
    console.log('发送消息到 content script, tabId:', tab.id);
    // 向 content script 发送消息打开模态框
    chrome.tabs.sendMessage(tab.id, {
      action: 'openModal'
    }, (response) => {
      if (chrome.runtime.lastError) {
        // 静默处理消息发送失败，不影响功能
        console.debug('Content script not ready:', chrome.runtime.lastError.message);
      }
    });
  }
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