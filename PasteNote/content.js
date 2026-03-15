// Content script for click-to-copy functionality
document.addEventListener('mouseup', (event) => {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  
  if (selectedText.length > 0) {
    // Show copy feedback
    const feedback = document.createElement('div');
    feedback.textContent = '已复制';
    feedback.style.cssText = `
      position: fixed;
      top: ${event.pageY - 30}px;
      left: ${event.pageX}px;
      background: #000;
      color: #fff;
      padding: 4px 8px;
      font-size: 12px;
      z-index: 10000;
      pointer-events: none;
    `;
    
    document.body.appendChild(feedback);
    
    // Copy to clipboard
    navigator.clipboard.writeText(selectedText).catch(err => {
      console.error('Copy failed:', err);
    });
    
    // Remove feedback after 1 second
    setTimeout(() => {
      document.body.removeChild(feedback);
    }, 1000);
  }
});