// 复用 popup.js 的 MemosPlugin 类和功能
// 侧边栏版本使用相同的逻辑，但 UI 适应侧边栏环境

class MemosPlugin {
  constructor() {
    this.notes = [];
    this.filteredNotes = [];
    this.currentFilter = { search: '', tags: [] };
    this.currentTabInfo = null; // 保存当前标签页信息
    this.init();
  }

  async init() {
    await this.loadNotes();
    await this.getCurrentTabInfo();
    this.bindEvents();
    this.renderNotes();
    this.renderTags();
    this.renderCalendar();
    this.updateSyncButtons();
    this.listenForTabChanges();
  }

  async getCurrentTabInfo() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        this.currentTabInfo = {
          url: tab.url,
          title: tab.title
        };
      }
    } catch (error) {
      console.error('Failed to get current tab info:', error);
    }
  }

  listenForTabChanges() {
    // 监听来自 background 的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'tabChanged' || message.type === 'tabUpdated') {
        this.currentTabInfo = {
          url: message.url,
          title: message.title
        };
        console.log('Tab info updated:', this.currentTabInfo);
      }
    });
  }

  async loadNotes() {
    const result = await chrome.storage.local.get(['memos_notes']);
    this.notes = result.memos_notes || [];
    this.filteredNotes = [...this.notes];
  }

  async saveNotes() {
    await chrome.storage.local.set({ memos_notes: this.notes });
    // 如果启用了云同步，自动上传到云端
    const result = await chrome.storage.local.get(['cos_enabled']);
    const syncEnabled = result.cos_enabled === true;
    if (syncEnabled) {
      this.syncToCloud();
    }
  }

  async syncToCloud() {
    const config = await this.getCloudConfig();
    if (!config) return;

    if (typeof CloudSync === 'undefined') return;

    try {
      const sync = new CloudSync(config);
      await sync.upload(this.notes);
      console.log('已自动同步到云端');
    } catch (err) {
      console.error('自动同步失败:', err.message);
    }
  }

  bindEvents() {
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.currentFilter.search = e.target.value;
      this.filterNotes();
    });

    document.getElementById('addUrlNoteBtn').addEventListener('click', () => {
      this.addUrlNote();
    });

    document.getElementById('addNoteBtn').addEventListener('click', () => {
      this.showNoteModal();
    });

    document.getElementById('saveNoteBtn').addEventListener('click', () => {
      this.saveNote();
    });

    document.getElementById('cancelBtn').addEventListener('click', () => {
      this.hideNoteModal();
    });

    document.getElementById('deleteNoteBtn').addEventListener('click', () => {
      this.deleteNote();
    });

    // 笔记模态框关闭
    document.querySelectorAll('#noteModal .close').forEach(el => {
      el.addEventListener('click', () => {
        this.hideNoteModal();
      });
    });

    // 同步模态框事件
    document.getElementById('syncBtn').addEventListener('click', () => {
      this.showSyncModal();
    });

    document.querySelectorAll('#syncModal .close').forEach(el => {
      el.addEventListener('click', () => {
        this.hideSyncModal();
      });
    });

    document.getElementById('enableCloudSync').addEventListener('change', (e) => {
      document.getElementById('cloudConfigSection').style.display =
        e.target.checked ? 'block' : 'none';
    });

    document.getElementById('saveSyncConfig').addEventListener('click', () => {
      this.saveSyncConfig();
    });

    document.getElementById('importBtn').addEventListener('click', () => {
      this.importNotes();
    });

    document.getElementById('exportBtn').addEventListener('click', () => {
      this.exportNotes();
    });

    // 标签列表鼠标拖动功能
    this.setupTagsListDrag();
  }

  setupTagsListDrag() {
    const tagsList = document.getElementById('tagsContainer');
    if (!tagsList) return;

    let isDown = false;
    let startX;
    let scrollLeft;

    tagsList.addEventListener('mousedown', (e) => {
      isDown = true;
      tagsList.classList.add('active');
      startX = e.pageX - tagsList.offsetLeft;
      scrollLeft = tagsList.scrollLeft;
    });

    tagsList.addEventListener('mouseleave', () => {
      isDown = false;
      tagsList.classList.remove('active');
    });

    tagsList.addEventListener('mouseup', () => {
      isDown = false;
      tagsList.classList.remove('active');
    });

    tagsList.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - tagsList.offsetLeft;
      const walk = (x - startX) * 2;
      tagsList.scrollLeft = scrollLeft - walk;
    });
  }

  filterNotes() {
    this.filteredNotes = this.notes.filter(note => {
      const matchesSearch = !this.currentFilter.search ||
        note.title.toLowerCase().includes(this.currentFilter.search.toLowerCase()) ||
        note.content.toLowerCase().includes(this.currentFilter.search.toLowerCase());

      // 如果搜索词是日期格式（YYYY-MM-DD），也检查笔记的创建日期
      let matchesDate = true;
      if (this.currentFilter.search && this.currentFilter.search.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const noteDate = new Date(note.createdAt);
        const year = noteDate.getFullYear();
        const month = String(noteDate.getMonth() + 1).padStart(2, '0');
        const day = String(noteDate.getDate()).padStart(2, '0');
        const noteDateStr = `${year}-${month}-${day}`;
        matchesDate = noteDateStr === this.currentFilter.search;
      }

      const matchesTags = this.currentFilter.tags.length === 0 ||
        this.currentFilter.tags.every(tag => note.tags.includes(tag));

      // 如果搜索词是日期，只匹配日期；否则匹配标题和内容
      if (this.currentFilter.search && this.currentFilter.search.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return matchesDate && matchesTags;
      }

      return matchesSearch && matchesTags;
    });
    // 置顶笔记排在前面
    this.filteredNotes.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });
    this.renderNotes();
  }

  renderNotes() {
    const container = document.getElementById('notesList');
    container.innerHTML = '';

    this.filteredNotes.forEach((note, index) => {
      const div = document.createElement('div');
      div.className = 'note-item' + (note.pinned ? ' pinned' : '');

      let titleHtml = '';
      if (note.title && note.title.trim()) {
        titleHtml = `<div class="note-title">${note.title}</div>`;
      }

      const createTime = new Date(note.createdAt).toLocaleString('zh-CN');

      div.innerHTML = `
        ${titleHtml}
        <div class="note-preview">${note.content.substring(0, 50)}${note.content.length > 50 ? '...' : ''}</div>
        <div class="note-tags">
          ${note.tags.map(tag => `<span class="note-tag">${tag}</span>`).join('')}
        </div>
        <div class="note-time">${createTime}</div>
        <div class="note-actions">
          <button class="note-pin-btn ${note.pinned ? 'pinned' : ''}" data-note-id="${note.id}" title="置顶">📌</button>
          <button class="note-edit-btn" data-note-id="${note.id}" title="编辑">✎</button>
          <button class="note-delete-btn" data-note-id="${note.id}" title="删除">×</button>
        </div>
      `;

      // 单击复制笔记内容
      div.addEventListener('click', (e) => {
        // 如果点击的是编辑、删除或置顶按钮，不触发复制
        if (e.target.classList.contains('note-edit-btn') || e.target.classList.contains('note-delete-btn') || e.target.classList.contains('note-pin-btn')) {
          return;
        }
        // 检查是否有 url 标签（不区分大小写）
        const hasUrlTag = note.tags.some(tag => tag.toLowerCase() === 'url');
        if (hasUrlTag) {
          // 如果有 url 标签，跳转到链接（笔记内容）
          window.open(note.content, '_blank');
        } else {
          // 否则复制笔记内容
          navigator.clipboard.writeText(note.content).then(() => {
            this.showToast('已复制笔记内容');
          });
        }
      });

      // 置顶按钮点击事件
      const pinBtn = div.querySelector('.note-pin-btn');
      pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actualIndex = this.notes.findIndex(n => n.id === note.id);
        this.notes[actualIndex].pinned = !this.notes[actualIndex].pinned;
        this.saveNotes();
        this.filterNotes();
      });

      // 编辑按钮点击事件
      const editBtn = div.querySelector('.note-edit-btn');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actualIndex = this.notes.findIndex(n => n.id === note.id);
        this.showNoteModal(actualIndex);
      });

      // 删除按钮点击事件
      const deleteBtn = div.querySelector('.note-delete-btn');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('确定删除此笔记？')) {
          const actualIndex = this.notes.findIndex(n => n.id === note.id);
          this.notes.splice(actualIndex, 1);
          this.saveNotes();
          this.filterNotes();
          this.renderTags();
          this.renderCalendar();
          this.showToast('笔记已删除');
        }
      });

      container.appendChild(div);
    });
  }

  renderTags() {
    const allTags = [...new Set(this.notes.flatMap(note => note.tags))];
    const container = document.getElementById('tagsContainer');
    container.innerHTML = '';

    allTags.forEach(tag => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.textContent = tag;
      span.addEventListener('click', () => this.toggleTagFilter(tag));
      container.appendChild(span);
    });
  }

  toggleTagFilter(tag) {
    const idx = this.currentFilter.tags.indexOf(tag);
    if (idx > -1) {
      this.currentFilter.tags.splice(idx, 1);
    } else {
      this.currentFilter.tags.push(tag);
    }
    document.querySelectorAll('.tag').forEach(el => {
      el.classList.toggle('active', this.currentFilter.tags.includes(el.textContent));
    });
    this.filterNotes();
  }

  renderCalendar() {
    const container = document.getElementById('contributionCalendar');
    container.innerHTML = '';

    // 获取今天的日期
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 获取有笔记的所有日期
    const noteDates = new Set();
    this.notes.forEach(note => {
      const noteDate = new Date(note.createdAt);
      const year = noteDate.getFullYear();
      const month = String(noteDate.getMonth() + 1).padStart(2, '0');
      const day = String(noteDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      noteDates.add(dateStr);
    });

    // 从今天往前推30周（210天），找到最早的一个周日
    let startDate = new Date(today);
    let weekCount = 30; // 30周
    // 往前推30周
    startDate.setDate(startDate.getDate() - (weekCount * 7));
    // 找到那个周日
    const startDayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - startDayOfWeek);

    // 计算到今天的总天数
    const totalDays = Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1;

    // 创建日期数组，从最早到今天
    const days = [];
    for (let i = 0; i < totalDays; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      days.push(date);
    }

    // 按照GitHub的方式排列：7行（周日到周六），按列从左到右渲染
    days.forEach(date => {
      // 只显示今天及之前的日期，且在有笔记的日期范围内
      if (date > today) return;

      // 使用本地时区格式化日期
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      const dayDiv = document.createElement('div');
      dayDiv.className = 'calendar-day';
      dayDiv.dataset.date = dateStr;

      const notesOnDay = this.notes.filter(note => {
        const noteDate = new Date(note.createdAt);
        const noteYear = noteDate.getFullYear();
        const noteMonth = String(noteDate.getMonth() + 1).padStart(2, '0');
        const noteDay = String(noteDate.getDate()).padStart(2, '0');
        const noteDateStr = `${noteYear}-${noteMonth}-${noteDay}`;
        return noteDateStr === dateStr;
      });
      const noteCount = notesOnDay.length;

      if (noteCount > 0) {
        // 颜色等级计算：1条=level1, 2-3条=level2, 4-5条=level3, 6+条=level4
        let level;
        if (noteCount === 1) level = 1;
        else if (noteCount <= 3) level = 2;
        else if (noteCount <= 5) level = 3;
        else level = 4;
        dayDiv.setAttribute('data-level', level);
      }

      // 鼠标悬停显示提示
      dayDiv.addEventListener('mouseenter', (e) => {
        if (noteCount > 0) {
          const tooltip = document.getElementById('calendarTooltip');
          tooltip.innerHTML = `${dateStr} · ${noteCount} 条笔记`;
          tooltip.style.display = 'block';

          // 计算位置，避免超出屏幕
          const tooltipWidth = tooltip.offsetWidth;
          const tooltipHeight = tooltip.offsetHeight;
          const windowWidth = window.innerWidth;
          const windowHeight = window.innerHeight;

          let left = e.clientX + 10;
          let top = e.clientY - tooltipHeight - 10;

          // 如果靠右边，tooltip 显示在左边
          if (left + tooltipWidth > windowWidth) {
            left = e.clientX - tooltipWidth - 10;
          }

          // 如果靠顶部，tooltip 显示在下方
          if (top < 10) {
            top = e.clientY + 10;
          }

          tooltip.style.left = left + 'px';
          tooltip.style.top = top + 'px';
        }
      });

      dayDiv.addEventListener('mousemove', (e) => {
        if (noteCount > 0) {
          const tooltip = document.getElementById('calendarTooltip');
          const tooltipWidth = tooltip.offsetWidth;
          const tooltipHeight = tooltip.offsetHeight;
          const windowWidth = window.innerWidth;
          const windowHeight = window.innerHeight;

          let left = e.clientX + 10;
          let top = e.clientY - tooltipHeight - 10;

          // 如果靠右边，tooltip 显示在左边
          if (left + tooltipWidth > windowWidth) {
            left = e.clientX - tooltipWidth - 10;
          }

          // 如果靠顶部，tooltip 显示在下方
          if (top < 10) {
            top = e.clientY + 10;
          }

          tooltip.style.left = left + 'px';
          tooltip.style.top = top + 'px';
        }
      });

      dayDiv.addEventListener('mouseleave', () => {
        document.getElementById('calendarTooltip').style.display = 'none';
      });

      // 点击格子
      dayDiv.addEventListener('click', () => {
        if (noteCount > 0) {
          // 点击绿块：显示当天的笔记
          this.currentFilter.search = dateStr;
          document.getElementById('searchInput').value = dateStr;
          this.filterNotes();
          this.renderNotes();
          this.showToast(`已显示 ${dateStr} 的笔记`);
        } else {
          // 点击空白格子：取消日期筛选
          if (this.currentFilter.search && this.currentFilter.search.match(/^\d{4}-\d{2}-\d{2}$/)) {
            this.currentFilter.search = '';
            document.getElementById('searchInput').value = '';
            this.filterNotes();
            this.renderNotes();
            this.showToast('已取消日期筛选');
          }
        }
      });

      container.appendChild(dayDiv);
    });

    // 在活跃度标题右边显示笔记总数
    const calendarContainer = document.querySelector('.calendar-container h3');
    if (calendarContainer) {
      // 移除之前存在的计数
      const existingCount = calendarContainer.querySelector('.note-count');
      if (existingCount) {
        existingCount.remove();
      }

      const countSpan = document.createElement('span');
      countSpan.className = 'note-count';
      countSpan.textContent = `${this.notes.length} 条笔记`;
      calendarContainer.appendChild(countSpan);
    }
  }

  showNoteModal(noteIndex = null) {
    this.editingIndex = noteIndex;
    this.selectedTags = [];
    this.availableTags = []; // 存储可用标签
    const modal = document.getElementById('noteModal');
    const title = document.getElementById('modalTitle');

    if (noteIndex !== null) {
      title.textContent = '编辑笔记';
      const note = this.notes[noteIndex];
      document.getElementById('noteTitle').value = note.title;
      document.getElementById('noteContent').value = note.content;
      this.selectedTags = [...note.tags];
    } else {
      title.textContent = '新建笔记';
      document.getElementById('noteTitle').value = '';
      document.getElementById('noteContent').value = '';
    }

    this.loadAvailableTags();
    this.renderTagsWrapper();
    this.bindTagInputEvents();

    modal.style.display = 'block';
  }

  hideNoteModal() {
    document.getElementById('noteModal').style.display = 'none';
  }

  loadAvailableTags() {
    // 从所有笔记中获取标签
    this.availableTags = [...new Set(this.notes.flatMap(note => note.tags))];
  }

  renderTagsWrapper() {
    const wrapper = document.getElementById('tagsWrapper');

    // 保留添加标签按钮，移除其他标签
    const addBtn = document.getElementById('addTagBtn');
    wrapper.innerHTML = '';
    wrapper.appendChild(addBtn);

    // 渲染所有可用标签
    this.availableTags.forEach(tag => {
      const tagEl = document.createElement('div');
      tagEl.className = 'tag' + (this.selectedTags.includes(tag) ? ' selected' : '');

      // 创建标签文本节点
      const tagText = document.createElement('span');
      tagText.textContent = tag;
      tagEl.appendChild(tagText);

      // 为所有标签添加删除按钮
      const deleteBtn = document.createElement('span');
      deleteBtn.className = 'tag-delete';
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteTag(tag);
      });
      tagEl.appendChild(deleteBtn);

      tagEl.addEventListener('click', () => {
        this.toggleTag(tag);
      });
      wrapper.appendChild(tagEl);
    });
  }

  bindTagInputEvents() {
    // 添加标签按钮
    const addTagBtn = document.getElementById('addTagBtn');
    addTagBtn.onclick = () => {
      this.showTagModal();
    };

    // 标签弹窗事件
    const tagModal = document.getElementById('tagModal');
    const newTagInput = document.getElementById('newTagInput');

    // 关闭按钮
    tagModal.querySelector('.close').onclick = () => {
      this.hideTagModal();
    };

    // 取消按钮
    document.getElementById('cancelAddTag').onclick = () => {
      this.hideTagModal();
    };

    // 确认添加按钮
    document.getElementById('confirmAddTag').onclick = () => {
      this.createNewTag();
    };

    // 输入框回车
    newTagInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.createNewTag();
      }
    };
  }

  showTagModal() {
    const modal = document.getElementById('tagModal');
    document.getElementById('newTagInput').value = '';
    modal.style.display = 'block';
    document.getElementById('newTagInput').focus();
  }

  hideTagModal() {
    document.getElementById('tagModal').style.display = 'none';
  }

  createNewTag() {
    const input = document.getElementById('newTagInput');
    const tagName = input.value.trim();

    if (!tagName) {
      alert('请输入标签名称');
      return;
    }

    if (this.selectedTags.includes(tagName)) {
      alert('该标签已被选中');
      return;
    }

    // 添加到可用标签列表
    if (!this.availableTags.includes(tagName)) {
      this.availableTags.push(tagName);
    }

    this.addTag(tagName);
    this.hideTagModal();
  }

  toggleTag(tag) {
    const index = this.selectedTags.indexOf(tag);
    if (index > -1) {
      this.selectedTags.splice(index, 1);
    } else {
      this.selectedTags.push(tag);
    }
    this.renderTagsWrapper();
  }

  addTag(tag) {
    if (!this.selectedTags.includes(tag)) {
      this.selectedTags.push(tag);
      this.renderTagsWrapper();
    }
  }

  removeTag(tag) {
    const index = this.selectedTags.indexOf(tag);
    if (index > -1) {
      this.selectedTags.splice(index, 1);
      this.renderTagsWrapper();
    }
  }

  deleteTag(tag) {
    if (confirm(`确定要删除标签"${tag}"吗？这将从所有笔记中移除此标签。`)) {
      // 从所有笔记中删除此标签
      this.notes.forEach(note => {
        const tagIndex = note.tags.indexOf(tag);
        if (tagIndex > -1) {
          note.tags.splice(tagIndex, 1);
        }
      });

      // 从当前选中的标签中移除
      const selectedIndex = this.selectedTags.indexOf(tag);
      if (selectedIndex > -1) {
        this.selectedTags.splice(selectedIndex, 1);
      }

      // 从可用标签列表中移除
      const availableIndex = this.availableTags.indexOf(tag);
      if (availableIndex > -1) {
        this.availableTags.splice(availableIndex, 1);
      }

      // 从当前过滤器中移除该标签
      const filterIndex = this.currentFilter.tags.indexOf(tag);
      if (filterIndex > -1) {
        this.currentFilter.tags.splice(filterIndex, 1);
      }

      this.saveNotes();
      this.renderTagsWrapper();
      this.renderTags();
      this.filterNotes();
      this.renderCalendar();
      this.showToast(`标签"${tag}"已删除`);
    }
  }

  saveNote() {
    const title = document.getElementById('noteTitle').value.trim();
    const content = document.getElementById('noteContent').value.trim();
    const tags = [...this.selectedTags];

    if (this.editingIndex !== null) {
      // 编辑现有笔记，保留原有的 createdAt
      const existingNote = this.notes[this.editingIndex];
      this.notes[this.editingIndex] = {
        ...existingNote,
        title,
        content,
        tags,
        updatedAt: new Date().toISOString()
      };
    } else {
      // 新建笔记
      const note = {
        id: Date.now(),
        title,
        content,
        tags,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.notes.unshift(note);
    }

    this.saveNotes();
    this.filterNotes();
    this.renderTags();
    this.renderCalendar();
    this.hideNoteModal();
  }

  editNote(index) {
    const actualIndex = this.notes.findIndex(note => note.id === this.filteredNotes[index].id);
    this.showNoteModal(actualIndex);
  }

  deleteNote() {
    if (this.editingIndex !== null && confirm('确定删除此笔记？')) {
      this.notes.splice(this.editingIndex, 1);
      this.saveNotes();
      this.filterNotes();
      this.renderTags();
      this.renderCalendar();
      this.hideNoteModal();
    }
  }

  async exportNotes() {
    const result = await chrome.storage.local.get(['cos_enabled']);
    const syncEnabled = result.cos_enabled === true;
    if (syncEnabled) {
      // 云端上传
      this.uploadToCloud();
    } else {
      // 本地导出
      const dataStr = JSON.stringify(this.notes, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `PasteNote-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
  }

  async importNotes() {
    const result = await chrome.storage.local.get(['cos_enabled']);
    const syncEnabled = result.cos_enabled === true;
    if (syncEnabled) {
      // 云端下载
      this.downloadFromCloud();
    } else {
      // 本地导入
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
          try {
            const text = await file.text();
            const importedNotes = JSON.parse(text);
            if (Array.isArray(importedNotes)) {
              // 清空原有笔记，只保留导入的笔记
              this.notes = importedNotes;
              this.saveNotes();
              this.filterNotes();
              this.renderNotes();
              this.renderTags();
              this.renderCalendar();
              alert('导入成功');
            } else {
              alert('无效的文件格式');
            }
          } catch (err) {
            alert('导入失败: ' + err.message);
          }
        }
      };
      input.click();
    }
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #000;
      color: #fff;
      padding: 8px 12px;
      font-size: 12px;
      z-index: 10000;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 2000);
  }

  async addUrlNote() {
    // 使用保存的当前标签页信息
    let url = '';
    let title = '';

    if (this.currentTabInfo && this.currentTabInfo.url) {
      url = this.currentTabInfo.url;
      title = this.currentTabInfo.title || '';
    } else {
      // 如果没有保存的信息，尝试获取
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
          url = tab.url;
          title = tab.title || '';
        } else {
          this.showToast('无法获取当前页面链接');
          return;
        }
      } catch (error) {
        this.showToast('无法获取当前页面链接');
        return;
      }
    }

    // 统一处理各种连字符和空格格式
    // 先将所有 &nbsp; 替换为普通空格
    title = title.replace(/&nbsp;/gi, ' ');

    // 处理各种连字符情况：&nbsp;-&nbsp;、&nbsp;-、-&nbsp;、 -
    title = title.replace(/\s*-\s*/g, ' - ');

    // 去掉第一个 " - " 及其后面的所有内容
    const dashIndex = title.indexOf(' - ');
    if (dashIndex > -1) {
      title = title.substring(0, dashIndex);
    }
    title = title.trim();

    // 创建新笔记
    const newNote = {
      id: Date.now().toString(),
      title: title,
      content: url,
      tags: ['URL'],
      createdAt: new Date().toISOString(),
      pinned: false
    };

    // 保存笔记
    this.notes.unshift(newNote);
    await this.saveNotes();
    this.filterNotes();
    this.renderTags();
    this.renderCalendar();
    this.showToast('已添加 URL 笔记');
  }

  async showSyncModal() {
    const modal = document.getElementById('syncModal');
    const enableCheckbox = document.getElementById('enableCloudSync');
    const secretIdInput = document.getElementById('syncSecretId');
    const secretKeyInput = document.getElementById('syncSecretKey');
    const bucketInput = document.getElementById('syncBucket');
    const regionInput = document.getElementById('syncRegion');

    // 加载保存的配置
    const result = await chrome.storage.local.get(['cos_enabled', 'cos_secretId', 'cos_secretKey', 'cos_bucket', 'cos_region']);
    const config = {
      enabled: result.cos_enabled === true,
      secretId: result.cos_secretId || '',
      secretKey: result.cos_secretKey || '',
      bucket: result.cos_bucket || '',
      region: result.cos_region || ''
    };

    enableCheckbox.checked = config.enabled;
    secretIdInput.value = config.secretId;
    secretKeyInput.value = config.secretKey;
    bucketInput.value = config.bucket;
    regionInput.value = config.region;

    document.getElementById('cloudConfigSection').style.display =
      config.enabled ? 'block' : 'none';

    modal.style.display = 'block';
  }

  hideSyncModal() {
    document.getElementById('syncModal').style.display = 'none';
  }

  async saveSyncConfig() {
    const enableCheckbox = document.getElementById('enableCloudSync');
    const secretId = document.getElementById('syncSecretId').value.trim();
    const secretKey = document.getElementById('syncSecretKey').value.trim();
    const bucket = document.getElementById('syncBucket').value.trim();
    const region = document.getElementById('syncRegion').value.trim();

    if (enableCheckbox.checked && (!secretId || !secretKey || !bucket || !region)) {
      alert('启用云同步时请填写完整的配置信息');
      return;
    }

    const storageData = {
      cos_enabled: enableCheckbox.checked
    };

    if (enableCheckbox.checked) {
      storageData.cos_secretId = secretId;
      storageData.cos_secretKey = secretKey;
      storageData.cos_bucket = bucket;
      storageData.cos_region = region;
      this.showToast('云同步配置已保存');
    } else {
      storageData.cos_secretId = '';
      storageData.cos_secretKey = '';
      storageData.cos_bucket = '';
      storageData.cos_region = '';
      this.showToast('已禁用云同步');
    }

    await chrome.storage.local.set(storageData);
    this.updateSyncButtons();
    this.hideSyncModal();
  }

  async getCloudConfig() {
    const result = await chrome.storage.local.get(['cos_enabled', 'cos_secretId', 'cos_secretKey', 'cos_bucket', 'cos_region']);
    const enabled = result.cos_enabled === true;
    if (!enabled) return null;

    return {
      secretId: result.cos_secretId,
      secretKey: result.cos_secretKey,
      bucket: result.cos_bucket,
      region: result.cos_region
    };
  }

  async downloadFromCloud() {
    const config = await this.getCloudConfig();
    if (!config) {
      alert('请先启用并配置云同步');
      return;
    }

    if (typeof CloudSync === 'undefined') {
      alert('云同步模块未加载');
      return;
    }

    try {
      const sync = new CloudSync(config);
      sync.download().then(notes => {
        if (notes) {
          if (confirm('下载云端数据将覆盖本地数据，是否继续？')) {
            this.notes = notes;
            this.saveNotes();
            this.filterNotes();
            this.renderTags();
            this.renderCalendar();
            this.showToast('已从云端下载数据');
          }
        } else {
          alert('云端暂无数据');
        }
      }).catch(err => {
        alert('下载失败: ' + err.message);
      });
    } catch (err) {
      alert('初始化同步失败: ' + err.message);
    }
  }

  uploadToCloud() {
    const config = this.getCloudConfig();
    if (!config) {
      alert('请先启用并配置云同步');
      return;
    }

    if (typeof CloudSync === 'undefined') {
      alert('云同步模块未加载');
      return;
    }

    try {
      const sync = new CloudSync(config);
      sync.upload(this.notes).then(() => {
        this.showToast('已上传到云端');
      }).catch(err => {
        alert('上传失败: ' + err.message);
      });
    } catch (err) {
      alert('初始化同步失败: ' + err.message);
    }
  }

  async updateSyncButtons() {
    const importBtn = document.getElementById('importBtn');
    const exportBtn = document.getElementById('exportBtn');
    const result = await chrome.storage.local.get(['cos_enabled']);
    const syncEnabled = result.cos_enabled === true;

    if (syncEnabled) {
      importBtn.textContent = '云端下载';
      exportBtn.textContent = '云端上传';
    } else {
      importBtn.textContent = '导入';
      exportBtn.textContent = '导出';
    }
  }


}

// 云同步模块将在HTML中通过script标签加载
// Initialize app
new MemosPlugin();
