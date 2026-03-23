// PasteNote Modal
class PasteNoteModal {
  constructor() {
    this.modal = null;
    this.notes = [];
    this.filteredNotes = [];
    this.currentPage = 1;
    this.pageSize = 20;
    this.isLoading = false;
    this.renderedCount = 0;
    this.keyboardHandler = this.handleKeyboard.bind(this);
    this.scrollHandler = null;
    this.lastFocusedElement = null;
    this.insertTargetElement = null; // 专门记录插入目标

    // 监听焦点变化
    document.addEventListener('focusin', (e) => {
      if (this.isEditableElement(e.target)) {
        this.lastFocusedElement = e.target;
      }
    });
  }

  isEditableElement(el) {
    if (!el) return false;
    return el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && ['text', 'search', 'email', 'url'].includes(el.type)) ||
      el.isContentEditable;
  }

  async findTargetInput() {
    // 优先使用最后聚焦的元素
    if (this.lastFocusedElement && this.isEditableElement(this.lastFocusedElement)) {
      return this.lastFocusedElement;
    }

    // 尝试使用当前激活元素
    const active = document.activeElement;
    if (this.isEditableElement(active)) {
      return active;
    }

    // 尝试使用当前选区
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      if (container.nodeType === Node.TEXT_NODE) {
        return container.parentElement;
      }
      return container;
    }

    return null;
  }

  async show() {
    // 加载笔记
    const result = await chrome.storage.local.get(['memos_notes']);
    this.notes = result.memos_notes || [];
    // 关键：对原始数据进行排序，确保后续所有操作都基于有序数据
    this.notes.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    this.filteredNotes = [...this.notes];
    this.currentPage = 1;
    this.renderedCount = 0;
    this.selectedTag = null;

    // 在打开模态框时记录插入目标
    this.insertTargetElement = await this.findTargetInput();

    if (!this.modal) {
      this.modal = this.createModal();
      document.body.appendChild(this.modal);
    }

    this.modal.style.display = 'flex';

    // 使用 requestAnimationFrame 确保 DOM 已更新
    requestAnimationFrame(() => {
      this.renderTags();
      this.renderNotes();
      // 重新绑定滚动事件
      this.bindScrollEvent();
    });

    // 添加键盘事件监听
    document.addEventListener('keydown', this.keyboardHandler);
  }

  hide() {
    if (this.modal) {
      this.modal.style.display = 'none';
    }
    document.removeEventListener('keydown', this.keyboardHandler);
  }

  createModal() {
    // 检查样式是否已存在，避免重复添加
    if (!document.getElementById('pastenote-modal-styles')) {
      const style = document.createElement('style');
      style.id = 'pastenote-modal-styles';
      style.textContent = `
        #pastenote-notes-content::-webkit-scrollbar {
          width: 6px;
        }
        #pastenote-notes-content::-webkit-scrollbar-track {
          background: #f0f0f0;
          border-radius: 3px;
        }
        #pastenote-notes-content::-webkit-scrollbar-thumb {
          background: #999;
          border-radius: 3px;
        }
        #pastenote-notes-content::-webkit-scrollbar-thumb:hover {
          background: #666;
        }
        #pastenote-tags-box.hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        #pastenote-tags-box {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
      `;
      document.head.appendChild(style);
    }

    // 创建全屏遮罩
    const overlay = document.createElement('div');
    overlay.id = 'pastenote-modal-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 2147483646;
    `;

    // 创建容器
    const container = document.createElement('div');
    container.id = 'pastenote-modal-container';
    container.style.cssText = `
      position: fixed;
      top: 100px;
      left: 50%;
      transform: translateX(-50%);
      background: #fff;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      overflow: visible;
      z-index: 2147483647;
    `;

    // 创建头部
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 16px;
      border-bottom: 1px solid #000;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    header.innerHTML = `
      <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: #000;">PasteNote</h2>
      <button id="pastenote-close-btn" style="
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
        color: #000;
        padding: 2px 8px;
        line-height: 1;
      ">&times;</button>
    `;

    // 创建搜索框
    const searchBox = document.createElement('div');
    searchBox.style.cssText = 'padding: 12px 16px;';
    searchBox.innerHTML = `
      <input type="text" id="pastenote-search" placeholder="搜索笔记..." style="
        width: 100%;
        padding: 8px;
        border: 1px solid #000;
        font-size: 14px;
        box-sizing: border-box;
        outline: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      " autocomplete="off">
    `;

    // 创建标签区域
    const tagsBox = document.createElement('div');
    tagsBox.id = 'pastenote-tags-box';
    tagsBox.style.cssText = `
      padding: 8px 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid #eee;
      overflow-x: auto;
      overflow-y: hidden;
      white-space: nowrap;
      scrollbar-width: none;
    `;
    tagsBox.classList.add('hide-scrollbar');

    // 创建内容区域
    const content = document.createElement('div');
    content.id = 'pastenote-notes-content';
    content.style.cssText = `
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 12px 16px;
      scrollbar-width: thin;
      scrollbar-color: #999 #f0f0f0;
      min-height: 0;
    `;

    // 组装
    container.appendChild(header);
    container.appendChild(searchBox);
    container.appendChild(tagsBox);
    container.appendChild(content);

    // 将遮罩和容器组合
    const wrapper = document.createElement('div');
    wrapper.id = 'pastenote-modal-wrapper';
    wrapper.appendChild(overlay);
    wrapper.appendChild(container);

    // 绑定事件
    container.querySelector('#pastenote-close-btn').addEventListener('click', () => this.hide());
    overlay.addEventListener('click', () => this.hide());
    container.querySelector('#pastenote-search').addEventListener('input', (e) => {
      this.filterNotes(e.target.value);
    });

    // 设置标签区域拖动效果
    this.setupTagsListDrag(tagsBox);

    return wrapper;
  }

  setupTagsListDrag(tagsBox) {
    if (!tagsBox) return;

    tagsBox.style.overflowX = 'auto';
    tagsBox.style.overflowY = 'hidden';

    let isDown = false;
    let startX;
    let scrollLeft;

    tagsBox.addEventListener('mousedown', (e) => {
      isDown = true;
      tagsBox.classList.add('active');
      startX = e.pageX - tagsBox.offsetLeft;
      scrollLeft = tagsBox.scrollLeft;
    });

    tagsBox.addEventListener('mouseleave', () => {
      isDown = false;
      tagsBox.classList.remove('active');
    });

    tagsBox.addEventListener('mouseup', () => {
      isDown = false;
      tagsBox.classList.remove('active');
    });

    tagsBox.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - tagsBox.offsetLeft;
      const walk = (x - startX) * 2;
      tagsBox.scrollLeft = scrollLeft - walk;
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  renderTags() {
    const tagsBox = document.getElementById('pastenote-tags-box');
    if (!tagsBox) return;

    // 收集所有标签
    const allTags = new Set();
    this.notes.forEach(note => {
      if (note.tags && note.tags.length > 0) {
        note.tags.forEach(tag => allTags.add(tag));
      }
    });

    tagsBox.innerHTML = '';

    // 如果没有标签，显示提示信息但不隐藏区域
    if (allTags.size === 0) {
      const emptyTip = document.createElement('span');
      emptyTip.style.cssText = `
        font-size: 12px;
        color: #999;
        padding: 4px 0;
      `;
      emptyTip.textContent = '暂无标签';
      tagsBox.appendChild(emptyTip);
      return;
    }

    // 添加"全部"标签
    const allTag = document.createElement('span');
    allTag.style.cssText = `
      padding: 1px 4px;
      border: 1px solid #000;
      font-size: 10px;
      cursor: pointer;
      transition: background 0.15s;
      white-space: nowrap;
      background: ${!this.selectedTag ? '#000' : '#fff'};
      color: ${!this.selectedTag ? '#fff' : '#000'};
    `;
      allTag.textContent = '全部';
       allTag.addEventListener('click', () => {
         this.selectedTag = null;
         this.currentPage = 1;
         this.renderedCount = 0;
         this.filteredNotes = [...this.notes];
         this.renderTags();
         this.renderNotes();
       });
    tagsBox.appendChild(allTag);

    // 添加其他标签
    allTags.forEach(tag => {
      const tagElement = document.createElement('span');
      tagElement.style.cssText = `
        padding: 1px 4px;
        border: 1px solid #000;
        font-size: 10px;
        cursor: pointer;
        transition: background 0.15s;
        white-space: nowrap;
        background: ${this.selectedTag === tag ? '#000' : '#fff'};
        color: ${this.selectedTag === tag ? '#fff' : '#000'};
      `;
      tagElement.textContent = tag;
        tagElement.addEventListener('click', () => {
          this.selectedTag = this.selectedTag === tag ? null : tag;
          this.currentPage = 1;
          this.renderedCount = 0;
          // 根据选中的标签过滤（this.notes已经是排序好的）
          this.filteredNotes = [...this.notes];
          if (this.selectedTag) {
            this.filteredNotes = this.filteredNotes.filter(note =>
              note.tags && note.tags.includes(this.selectedTag)
            );
          }
          this.renderTags();
          this.renderNotes();
        });
      tagsBox.appendChild(tagElement);
    });
  }

  async insertNoteContent(content) {
    // 使用打开模态框时记录的插入目标
    let targetInput = this.insertTargetElement;

    // 如果记录的目标不存在或不可编辑，尝试重新查找
    if (!targetInput || !this.isEditableElement(targetInput)) {
      targetInput = await this.findTargetInput();
    }

    if (!targetInput || !this.isEditableElement(targetInput)) {
      alert('未找到可编辑的输入框，请先点击输入框');
      return;
    }

    // 清空现有内容
    if (targetInput.isContentEditable) {
      targetInput.innerHTML = '';
    } else {
      targetInput.value = '';
    }
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));

    // 插入内容
    if (targetInput.isContentEditable) {
      await this.insertContentEditable(targetInput, content);
    } else {
      await this.insertInput(targetInput, content);
    }

    // 聚焦输入框
    targetInput.focus();

    // 关闭模态框
    this.hide();
  }

  async insertInput(element, content) {
    const newValue = content;
    element.value = newValue;

    const newCursorPos = content.length;
    element.setSelectionRange(newCursorPos, newCursorPos);

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async insertContentEditable(element, content) {
    const selection = window.getSelection();
    let inserted = false;

    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (element.contains(range.commonAncestorContainer)) {
        range.deleteContents();

        // 处理多行文本
        const lines = content.split('\n');
        const fragment = document.createDocumentFragment();

        lines.forEach((line, index) => {
          fragment.appendChild(document.createTextNode(line));
          if (index < lines.length - 1) {
            fragment.appendChild(document.createElement('br'));
          }
        });

        range.insertNode(fragment);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        inserted = true;
      }
    }

    if (!inserted) {
      // 如果无法插入到选区，直接设置 innerHTML
      const htmlContent = content.split('\n').map(line => {
        const escaped = line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<p>${escaped || '<br>'}</p>`;
      }).join('');

      element.innerHTML = htmlContent;

      // 移动光标到末尾
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(element);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  renderNotes() {
    const content = document.getElementById('pastenote-notes-content');
    if (!content) return;

    // 如果是第一次加载或重新渲染，清空容器
    if (this.currentPage === 1) {
      content.innerHTML = '';
      this.renderedCount = 0;
    }

    // 如果没有笔记
    if (this.filteredNotes.length === 0) {
      if (this.currentPage === 1) {
        content.innerHTML = `
          <div style="
            text-align: center;
            padding: 40px 20px;
            color: #999;
          ">
            <div style="font-size: 36px; margin-bottom: 12px;">📝</div>
            <div style="font-size: 14px; margin-bottom: 6px;">暂无笔记</div>
            <div style="font-size: 12px;">请先创建一些笔记</div>
          </div>
        `;
      }
      return;
    }

    // 计算要渲染的笔记范围
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = Math.min(startIndex + this.pageSize, this.filteredNotes.length);

    // 如果没有更多笔记，移除加载提示
    if (startIndex >= this.filteredNotes.length) {
      const loadingIndicator = document.getElementById('pastenote-loading');
      if (loadingIndicator) {
        loadingIndicator.textContent = '已加载全部笔记';
        loadingIndicator.style.display = 'block';
      }
      return;
    }

    // 渲染当前页的笔记
    for (let i = startIndex; i < endIndex; i++) {
      const note = this.filteredNotes[i];
       const noteItem = document.createElement('div');
       noteItem.className = 'pastenote-note-item';
       
       // 创建时间
       const createTime = new Date(note.createdAt).toLocaleString('zh-CN');

       if (note.pinned) {
         // 置顶笔记：黑底白字，与侧边栏一致
         noteItem.style.cssText = `
           background: #000;
           color: #fff;
           border: 1px solid #000;
           padding: 8px;
           margin-bottom: 8px;
           cursor: pointer;
           position: relative;
         `;
         noteItem.innerHTML = `
           <div style="
             font-weight: 600;
             margin-bottom: 4px;
             padding-right: 40px;
             overflow: hidden;
             text-overflow: ellipsis;
             white-space: nowrap;
             font-size: 14px;
           ">
             ${this.escapeHtml(note.title || '无标题')}
           </div>
           <div style="
             font-size: 12px;
             color: rgba(255, 255, 255, 0.8);
             margin-bottom: 4px;
             padding-right: 40px;
             overflow: hidden;
             text-overflow: ellipsis;
             white-space: nowrap;
           ">
             ${this.escapeHtml(note.content.substring(0, 50))}${note.content.length > 50 ? '...' : ''}
           </div>
           ${note.tags && note.tags.length > 0 ? `
             <div style="
               display: flex;
               gap: 4px;
               flex-wrap: wrap;
               padding-right: 40px;
             ">
               ${note.tags.map(tag => `
                 <span style="
                   font-size: 10px;
                   padding: 1px 4px;
                   border: 1px solid rgba(255, 255, 255, 0.5);
                   color: #fff;
                 ">
                   ${this.escapeHtml(tag)}
                 </span>
               `).join('')}
             </div>
           ` : ''}
           <div style="
             font-size: 10px;
             color: rgba(255, 255, 255, 0.6);
             position: absolute;
             bottom: 1px;
             right: 2px;
           ">${createTime}</div>
         `;
       } else {
         // 普通笔记：原来的样式
         noteItem.style.cssText = `
           border: 1px solid #000;
           padding: 8px;
           margin-bottom: 8px;
           cursor: pointer;
           position: relative;
         `;
         noteItem.innerHTML = `
           <div style="
             font-weight: 600;
             margin-bottom: 4px;
             padding-right: 40px;
             overflow: hidden;
             text-overflow: ellipsis;
             white-space: nowrap;
             font-size: 14px;
           ">
             ${this.escapeHtml(note.title || '无标题')}
           </div>
           <div style="
             font-size: 12px;
             color: #666;
             margin-bottom: 4px;
             padding-right: 40px;
             overflow: hidden;
             text-overflow: ellipsis;
             white-space: nowrap;
           ">
             ${this.escapeHtml(note.content.substring(0, 50))}${note.content.length > 50 ? '...' : ''}
           </div>
           ${note.tags && note.tags.length > 0 ? `
             <div style="
               display: flex;
               gap: 4px;
               flex-wrap: wrap;
               padding-right: 40px;
             ">
               ${note.tags.map(tag => `
                 <span style="
                   font-size: 10px;
                   padding: 1px 4px;
                   border: 1px solid #999;
                 ">
                   ${this.escapeHtml(tag)}
                 </span>
               `).join('')}
             </div>
           ` : ''}
           <div style="
             font-size: 10px;
             color: #999;
             position: absolute;
             bottom: 1px;
             right: 2px;
           ">${createTime}</div>
         `;
       }

       // 鼠标悬停效果：只有普通笔记会变，置顶笔记保持黑色
       if (!note.pinned) {
         noteItem.addEventListener('mouseenter', () => {
           noteItem.style.background = '#f5f5f5';
         });
         noteItem.addEventListener('mouseleave', () => {
           noteItem.style.background = '#fff';
         });
       }

      // 点击插入内容到输入框
      noteItem.addEventListener('click', () => {
        this.insertNoteContent(note.content || '');
      });

      content.appendChild(noteItem);
      this.renderedCount = endIndex;
    }

    // 更新加载提示
    this.updateLoadingIndicator();
  }

  filterNotes(keyword) {
      const content = document.getElementById('pastenote-notes-content');
      if (!content) return;

      // 根据选中的标签过滤，并保持排序
      this.filteredNotes = [...this.notes];
      if (this.selectedTag) {
        this.filteredNotes = this.filteredNotes.filter(note =>
          note.tags && note.tags.includes(this.selectedTag)
        );
      }

      // 再根据关键词过滤
      this.filteredNotes = this.filteredNotes.filter(note =>
        (note.title || '').toLowerCase().includes(keyword.toLowerCase()) ||
        (note.content || '').toLowerCase().includes(keyword.toLowerCase()) ||
        (note.tags && note.tags.some(tag => tag.toLowerCase().includes(keyword.toLowerCase())))
      );

      // 置顶笔记排在前面，非置顶的按创建时间倒序排列（与popup/sidebar保持一致）
      this.filteredNotes.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        // 都是置顶或都不是置顶时，按创建时间倒序（新的在前）
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      this.currentPage = 1;
      this.renderedCount = 0;

      if (this.filteredNotes.length === 0) {
        content.innerHTML = '';
        content.innerHTML = `
          <div style="
            text-align: center;
            padding: 40px 20px;
            color: #999;
          ">
            <div style="font-size: 36px; margin-bottom: 12px;">🔍</div>
            <div>没有找到匹配的笔记</div>
          </div>
        `;
        return;
      }

      this.renderNotes();
    }

  handleKeyboard(event) {
    if (!this.modal || this.modal.style.display === 'none') {
      return;
    }

    // ESC 关闭
    if (event.key === 'Escape') {
      event.preventDefault();
      this.hide();
    }
  }

  updateLoadingIndicator() {
    const content = document.getElementById('pastenote-notes-content');
    if (!content) return;

    // 创建或更新加载提示
    let loadingIndicator = document.getElementById('pastenote-loading');

    if (this.renderedCount < this.filteredNotes.length) {
      if (!loadingIndicator) {
        loadingIndicator = document.createElement('div');
        loadingIndicator.id = 'pastenote-loading';
        loadingIndicator.style.cssText = `
          text-align: center;
          padding: 20px;
          color: #999;
          font-size: 14px;
          display: none;
        `;
        loadingIndicator.textContent = '加载中...';
        content.appendChild(loadingIndicator);
      }
      loadingIndicator.style.display = 'none';
    } else {
      // 不显示"已加载全部笔记"，直接隐藏加载提示
      if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
      }
    }
  }

  bindScrollEvent() {
    const content = document.getElementById('pastenote-notes-content');
    if (!content) {
      return;
    }

    // 移除旧的监听器（如果存在）
    if (this.scrollHandler) {
      content.removeEventListener('scroll', this.scrollHandler);
    }

    // 创建并绑定新的监听器
    this.scrollHandler = () => {
      // 如果正在加载或已加载全部，不处理
      if (this.isLoading || this.renderedCount >= this.filteredNotes.length) {
        return;
      }

      // 计算滚动位置
      const scrollTop = content.scrollTop || 0;
      const scrollHeight = content.scrollHeight || 0;
      const clientHeight = content.clientHeight || 0;

      // 当滚动到距离底部150px时开始加载
      const threshold = 150;
      const distanceToBottom = scrollHeight - scrollTop - clientHeight;

      // 使用更宽松的条件：距离底部小于等于阈值时触发
      if (distanceToBottom <= threshold) {
        this.loadMoreNotes();
      }
    };

    content.addEventListener('scroll', this.scrollHandler);
  }

  async loadMoreNotes() {
    if (this.isLoading) return;

    this.isLoading = true;

    const loadingIndicator = document.getElementById('pastenote-loading');
    if (loadingIndicator) {
      loadingIndicator.textContent = '加载中...';
      loadingIndicator.style.display = 'block';
    }

    // 模拟异步加载延迟
    await new Promise(resolve => setTimeout(resolve, 300));

    this.currentPage++;
    this.renderNotes();

    this.isLoading = false;

    // 隐藏加载提示
    if (loadingIndicator) {
      loadingIndicator.style.display = 'none';
    }
  }

  showToast(message) {
    // 移除现有的 toast
    const existingToast = document.getElementById('pastenote-toast');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'pastenote-toast';
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #000;
      color: #fff;
      padding: 8px 16px;
      font-size: 14px;
      z-index: 2147483648;
      animation: fadeIn 0.3s;
    `;
    toast.textContent = message;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 2000);
  }
}

// 创建全局模态框实例
const pastenoteModal = new PasteNoteModal();

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'openModal') {
    pastenoteModal.show();
    return true;
  }
});