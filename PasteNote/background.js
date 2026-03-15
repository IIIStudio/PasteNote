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