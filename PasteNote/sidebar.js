// 复用 popup.js 的 MemosPlugin 类和功能
// 侧边栏版本使用相同的逻辑，但 UI 适应侧边栏环境

class MemosPlugin {
  constructor() {
    this.notes = [];
    this.filteredNotes = [];
    this.categories = {
      "default": []
    }; // 分类数据结构
    this.currentCategory = 'default'; // 当前选中的分类
    this.currentFilter = { search: '', tags: [] };
    this.currentTabInfo = null; // 保存当前标签页信息
    this.currentPage = 1;
    this.pageSize = 20;
    this.isLoading = false;
    // 从存储中恢复上次选择的分类
    this.restoreLastCategory();
    this.init();
  }

  async init() {
     await this.loadNotes();
     await this.getCurrentTabInfo();
     this.bindEvents();
     // 在 init 中调用 filterNotes 而不是 renderNotes，确保正确的排序
     this.filterNotes();
     this.renderCategories();
     this.renderTags();
     this.renderCalendar();
     this.updateSyncButtons();
     this.listenForTabChanges();
     this.bindScrollEvent();
     // 保存当前分类到存储
     this.saveLastCategory();
   }

async loadNotes() {
   const result = await chrome.storage.local.get(['memos_notes', 'memos_categories']);
   this.notes = result.memos_notes || [];
   this.categories = result.memos_categories || {
     "default": []
   };
   // 为旧数据添加颜色属性
   this.notes.forEach(note => {
     if (!note.color) {
       note.color = 'white';
     }
     if (!note.category) {
       note.category = 'default';
     }
   });
   // 确保 filteredNotes 正确初始化，保持置顶顺序：先排序再复制
   const sortedNotes = [...this.notes];
   sortedNotes.sort((a, b) => {
     if (a.pinned && !b.pinned) return -1;
     if (!a.pinned && b.pinned) return 1;
     return new Date(b.createdAt) - new Date(a.createdAt);
   });
   this.filteredNotes = sortedNotes;
   this.currentPage = 1;
   this.renderedCount = 0;
 }

  async saveNotes() {
    await chrome.storage.local.set({ 
  memos_notes: this.notes,
  memos_categories: this.categories
});
    // 如果启用了云同步，自动上传到云端
    const result = await chrome.storage.local.get(['cos_enabled']);
    const syncEnabled = result.cos_enabled === true;
    if (syncEnabled) {
      this.syncToCloud();
    }
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
        }
      });
    }

   // 分类管理方法
   addCategory(categoryName) {
     if (!categoryName || this.categories[categoryName]) {
       return false;
     }
     this.categories[categoryName] = [];
     this.saveNotes();
     this.renderCategories();
     return true;
   }

  // 恢复上次选择的分类
  async restoreLastCategory() {
    try {
      const result = await chrome.storage.local.get(['lastSelectedCategory']);
      if (result.lastSelectedCategory && this.categories[result.lastSelectedCategory]) {
        this.currentCategory = result.lastSelectedCategory;
      }
    } catch (error) {
      console.log('恢复分类失败:', error);
    }
  }

  // 保存当前分类到存储
  async saveLastCategory() {
    try {
      await chrome.storage.local.set({ lastSelectedCategory: this.currentCategory });
    } catch (error) {
      console.log('保存分类失败:', error);
    }
  }

   deleteCategory(categoryName) {
        console.log('deleteCategory called with:', categoryName);
        console.log('Current categories before delete:', JSON.stringify(this.categories));
        
        if (categoryName === 'default') {
          this.showToast('默认分类不能删除');
          return false;
        }
        
        // 如果删除的是当前选中的分类，切换到默认分类
        if (this.currentCategory === categoryName) {
          this.currentCategory = 'default';
          this.saveLastCategory();
        }
        
        // 彻底删除该分类下的所有笔记
        if (this.categories[categoryName]) {
          const notesToDelete = this.notes.filter(note => note.category === categoryName);
          if (notesToDelete.length > 0) {
            if (!confirm(`此分类下有 ${notesToDelete.length} 个笔记，删除分类将同时删除这些笔记。确定继续吗？`)) {
              return false;
            }
            // 从notes数组中删除这些笔记
            this.notes = this.notes.filter(note => note.category !== categoryName);
          }
          delete this.categories[categoryName];
          this.saveNotes();
          
          console.log('Categories after delete:', JSON.stringify(this.categories));
          
          // 立即重新渲染分类（同步）
          this.renderCategories();
          
          // 然后异步再次渲染确保更新
          requestAnimationFrame(() => {
            console.log('Re-rendering categories in next frame');
            this.renderCategories();
            
            // 强制触发重排
            const container = document.getElementById('categoriesContainer');
            if (container) {
              container.style.display = 'none';
              container.offsetHeight; // 强制重排
              container.style.display = '';
            }
          });
          
          this.renderTags();
          this.filterNotes();
          this.renderCalendar();
          this.renderNotes();
          
          this.showToast(`分类"${categoryName}"已删除，相关笔记已彻底删除`);
          return true;
        }
        console.log('Category not found:', categoryName);
        return false;
      }

  switchCategory(categoryName) {
    if (this.categories[categoryName]) {
      this.currentCategory = categoryName;
      this.filterNotes();
      this.renderCategories();
      this.renderTags();
      // 保存当前分类到存储
      this.saveLastCategory();
    }
  }

     renderCategories() {
       console.log('renderCategories called, current categories:', Object.keys(this.categories));
       const container = document.getElementById('categoriesContainer');
       if (!container) return;
       
       // 完全重建分类容器内容
       const defaultBtn = container.querySelector('button[data-category="default"]');
       const addBtn = container.querySelector('#addCategoryBtn');
       
       // 保存静态按钮的引用
       const staticElements = [];
       if (defaultBtn) staticElements.push(defaultBtn);
       if (addBtn) staticElements.push(addBtn);
       
       // 清空容器
       container.innerHTML = '';
       
       // 重新添加静态按钮
       staticElements.forEach(el => container.appendChild(el));
       
       // 为每个分类创建按钮（除了默认分类）
       Object.keys(this.categories).forEach(category => {
         if (category !== 'default') {
           const btn = document.createElement('button');
           btn.className = 'btn btn-small category-btn' + (category === this.currentCategory ? ' active' : '');
           btn.textContent = category;
           btn.dataset.category = category;
           
           // 添加删除按钮
           const deleteBtn = document.createElement('span');
           deleteBtn.className = 'delete-category';
           deleteBtn.textContent = ' ×';
           deleteBtn.style.cursor = 'pointer';
           deleteBtn.style.marginLeft = '4px';
           deleteBtn.addEventListener('click', (e) => {
             e.stopPropagation();
             console.log('删除按钮被点击，分类:', category);
             if (confirm(`确定要删除分类"${category}"吗？`)) {
               this.deleteCategory(category);
             }
           });
           btn.appendChild(deleteBtn);
           
           // 插入到添加按钮之前
           if (addBtn) {
             container.insertBefore(btn, addBtn);
           } else {
             container.appendChild(btn);
           }
         }
        });
        
        // 更新默认按钮的激活状态 - 只有当前选中分类是default时才激活
        if (defaultBtn) {
          if (this.currentCategory === 'default') {
            defaultBtn.classList.add('active');
          } else {
            defaultBtn.classList.remove('active');
          }
        }
        
        console.log('renderCategories completed, buttons in container:', container.children.length);
      }

   changeNoteColor(noteId, color) {
    const noteIndex = this.notes.findIndex(note => note.id == noteId);
    if (noteIndex !== -1) {
      this.notes[noteIndex].color = color;
      this.saveNotes();
      this.filterNotes();
      this.showToast('笔记颜色已更新');
    }
  }

  showColorPicker(noteId, event) {
    event.stopPropagation();
    
    // 移除现有的颜色选择器
    const existingPicker = document.querySelector('.note-color-picker-popup');
    if (existingPicker) {
      existingPicker.remove();
      return;
    }
    
    // 创建颜色选择器弹窗
    const picker = document.createElement('div');
    picker.className = 'note-color-picker-popup';
    picker.style.cssText = `
      position: absolute;
      background: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 8px;
      z-index: 10000;
      display: flex;
      gap: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;
    
    const colors = [
      { name: 'white', value: 'white', style: 'background: white; border: 1px solid #ccc;' },
      { name: 'yellow', value: 'ffe66e', style: 'background: #ffe66e;' },
      { name: 'green', value: 'a1ef9b', style: 'background: #a1ef9b;' },
      { name: 'pink', value: 'ffafdf', style: 'background: #ffafdf;' },
      { name: 'purple', value: 'd7afff', style: 'background: #d7afff;' },
      { name: 'lightblue', value: '9edfff', style: 'background: #9edfff;' },
      { name: 'lightgray', value: 'e0e0e0', style: 'background: #e0e0e0;' },
      { name: 'gray', value: '767676', style: 'background: #767676;' }
    ];
    
    colors.forEach(color => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        padding: 0;
        ${color.style}
      `;
      btn.title = color.name;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.changeNoteColor(noteId, color.value);
        picker.remove();
      });
      picker.appendChild(btn);
    });
    
    // 定位颜色选择器
    const rect = event.target.getBoundingClientRect();
    picker.style.left = rect.left + 'px';
    picker.style.top = (rect.bottom + 5) + 'px';
    
    document.body.appendChild(picker);
    
    // 点击其他地方关闭颜色选择器
    setTimeout(() => {
      document.addEventListener('click', function closePicker() {
        picker.remove();
        document.removeEventListener('click', closePicker);
      });
    }, 0);
  }

  async saveColor() {
    await chrome.storage.local.set({ memos_color: this.currentColor });
  }

  bindColorPickerEvents() {
    document.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        this.setColor(color);
      });
    });
  }

  setColor(color) {
    this.currentColor = color;
    
    // 更新按钮状态
    document.querySelectorAll('.color-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === color);
    });
    
    // 保存到浏览器存储
    this.saveColor();
    
    // 应用颜色到新建笔记
    this.applyColorToEditor();
    
    this.showToast(`颜色已切换为 ${color === 'white' ? '默认' : '#' + color}`);
  }

  getColorClassName(color) {
    const colorMap = {
      'ffe66e': 'yellow',
      'a1ef9b': 'green',
      'ffafdf': 'pink',
      'd7afff': 'purple',
      '9edfff': 'lightblue',
      'e0e0e0': 'lightgray',
      '767676': 'gray'
    };
    return colorMap[color] || '';
  }

  applyColorToEditor(color = this.currentColor) {
    const modal = document.getElementById('noteModal');
    if (modal.style.display === 'block') {
      const titleInput = document.getElementById('noteTitle');
      const contentTextarea = document.getElementById('noteContent');
      
      if (color === '767676') {
        // 灰色背景，字体改为白色
        titleInput.style.backgroundColor = '#767676';
        titleInput.style.color = '#ffffff';
        contentTextarea.style.backgroundColor = '#767676';
        contentTextarea.style.color = '#ffffff';
      } else {
        // 其他颜色，恢复默认样式
        titleInput.style.backgroundColor = '';
        titleInput.style.color = '';
        contentTextarea.style.backgroundColor = '';
        contentTextarea.style.color = '';
      }
    }
  }

  async syncToCloud() {
    const config = await this.getCloudConfig();
    if (!config) return;

    if (typeof CloudSync === 'undefined') return;

    try {
      const sync = new CloudSync(config);
      await sync.upload(this.notes);
    } catch (err) {
    }
  }

     bindEvents() {
       document.getElementById('searchInput').addEventListener('input', (e) => {
         this.currentFilter.search = e.target.value;
         this.filterNotes();
       });

      // 分类容器事件委托 - 处理分类切换和删除
      document.getElementById('categoriesContainer').addEventListener('click', (e) => {
        // 优先处理删除按钮
        const deleteBtn = e.target.closest('.delete-category');
        if (deleteBtn) {
          e.stopPropagation();
          e.preventDefault();
          const categoryBtn = deleteBtn.parentElement;
          const categoryName = categoryBtn.dataset.category;
          console.log('分类删除按钮被点击:', categoryName);
          if (confirm(`确定要删除分类"${categoryName}"吗？`)) {
            this.deleteCategory(categoryName);
          }
          return;
        }
        
        // 处理分类切换
        const categoryBtn = e.target.closest('button[data-category]');
        if (categoryBtn && categoryBtn.id !== 'addCategoryBtn') {
          const categoryName = categoryBtn.dataset.category;
          this.switchCategory(categoryName);
        }
      });

     // 添加分类按钮事件
     document.getElementById('addCategoryBtn').addEventListener('click', () => {
       const categoryName = prompt('请输入分类名称:');
       if (categoryName && this.addCategory(categoryName)) {
         this.showToast(`分类"${categoryName}"已添加`);
       } else if (categoryName) {
         this.showToast('分类已存在或名称无效');
       }
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

     // 删除笔记按钮已移除，不需要绑定事件

     // 笔记模态框关闭 - 使用统一的关闭触发器
      document.querySelectorAll('.modal-close-trigger[data-target="noteModal"]').forEach(el => {
        el.addEventListener('click', () => {
          this.hideNoteModal();
        });
      });

      // 笔记模态框右上角 X 按钮关闭
      document.querySelector('#noteModal .close').addEventListener('click', () => {
        this.hideNoteModal();
      });

     // 同步模态框事件
     document.getElementById('syncBtn').addEventListener('click', () => {
       this.showSyncModal();
     });

     // 同步模态框关闭 - 使用统一的关闭触发器
      document.querySelectorAll('.modal-close-trigger[data-target="syncModal"]').forEach(el => {
        el.addEventListener('click', () => {
          this.hideSyncModal();
        });
      });

      // 同步模态框右上角 X 按钮关闭
      document.querySelector('#syncModal .close').addEventListener('click', () => {
        this.hideSyncModal();
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
      // 分类过滤
      if (note.category !== this.currentCategory) {
        return false;
      }
      
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
     // 置顶笔记排在前面，非置顶的按创建时间倒序排列
     this.filteredNotes.sort((a, b) => {
       if (a.pinned && !b.pinned) return -1;
       if (!a.pinned && b.pinned) return 1;
       // 都是置顶或都不是置顶时，按创建时间倒序（新的在前）
       return new Date(b.createdAt) - new Date(a.createdAt);
     });
     this.currentPage = 1;
     this.renderNotes();
   }

  renderNotes() {
    const container = document.getElementById('notesList');

    // 如果是第一次加载或重新渲染，清空容器
    if (this.currentPage === 1) {
      container.innerHTML = '';
      this.renderedCount = 0;
    }

    // 计算要渲染的笔记范围
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = Math.min(startIndex + this.pageSize, this.filteredNotes.length);

      // 如果没有更多笔记，移除加载提示
      if (startIndex >= this.filteredNotes.length) {
        const loadMoreBtn = document.getElementById('loadMoreBtn');
        if (loadMoreBtn) {
          loadMoreBtn.style.display = 'none';
        }
        return;
      }

    // 渲染当前页的笔记
    for (let i = startIndex; i < endIndex; i++) {
      const note = this.filteredNotes[i];
      const div = document.createElement('div');
      let className = 'note-item';
      if (note.pinned) {
        className += ' pinned';
      } else if (note.color && note.color !== 'white') {
        className += ' ' + this.getColorClassName(note.color);
      }
      div.className = className;

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
          <div class="color-picker-container" data-note-id="${note.id}">
            <button class="color-btn small ${note.color === 'white' ? 'active' : ''}" data-color="white" style="background: white; border: 1px solid #ccc;"></button>
            <button class="color-btn small" data-color="ffe66e" style="background: #ffe66e;"></button>
            <button class="color-btn small" data-color="a1ef9b" style="background: #a1ef9b;"></button>
            <button class="color-btn small" data-color="ffafdf" style="background: #ffafdf;"></button>
            <button class="color-btn small" data-color="d7afff" style="background: #d7afff;"></button>
            <button class="color-btn small" data-color="9edfff" style="background: #9edfff;"></button>
            <button class="color-btn small" data-color="e0e0e0" style="background: #e0e0e0;"></button>
            <button class="color-btn small" data-color="767676" style="background: #767676;"></button>
          </div>
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

      // 颜色按钮点击事件
      const colorPicker = div.querySelector('.color-picker-container');
      colorPicker.addEventListener('click', (e) => {
        e.stopPropagation();
        const colorBtn = e.target.closest('.color-btn.small');
        if (colorBtn) {
          const color = colorBtn.dataset.color;
          this.changeNoteColor(note.id, color);
          
          // 更新按钮激活状态
          colorPicker.querySelectorAll('.color-btn.small').forEach(btn => {
            btn.classList.toggle('active', btn === colorBtn);
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
      this.renderedCount = endIndex;
    }

    // 更新或创建加载更多按钮
    this.updateLoadMoreButton();
  }

  renderTags() {
    // 只获取当前分类下的笔记的标签
    const currentCategoryNotes = this.notes.filter(note => note.category === this.currentCategory);
    const allTags = [...new Set(currentCategoryNotes.flatMap(note => note.tags))];
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
      const pinnedBanner = document.getElementById('pinnedBanner');

      if (noteIndex !== null) {
        title.textContent = '编辑笔记';
        const note = this.notes[noteIndex];
        document.getElementById('noteTitle').value = note.title;
        document.getElementById('noteContent').value = note.content;
        this.selectedTags = [...note.tags];
        // 恢复笔记原有颜色
        this.applyColorToEditor(note.color || 'white');
        // 编辑笔记时显示或隐藏置顶横幅
        if (pinnedBanner) {
          pinnedBanner.style.display = note.pinned ? 'block' : 'none';
        }
    } else {
      title.textContent = '新建笔记';
      document.getElementById('noteTitle').value = '';
      document.getElementById('noteContent').value = '';
      // 新建笔记时隐藏置顶横幅
      if (pinnedBanner) {
        pinnedBanner.style.display = 'none';
      }
      // 设置新建笔记的默认颜色为白色
      this.currentColor = 'white';
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
       deleteBtn.title = '删除标签';
       deleteBtn.addEventListener('click', (e) => {
         e.stopPropagation();
         e.preventDefault();
         console.log('标签删除按钮被点击:', tag);
         this.deleteTag(tag);
       });
       tagEl.appendChild(deleteBtn);

       tagEl.addEventListener('click', (e) => {
         // 如果点击的是删除按钮，不触发切换
         if (e.target.classList.contains('tag-delete')) {
           return;
         }
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

      // 关闭按钮 - 使用统一的关闭触发器
      document.querySelectorAll('.modal-close-trigger[data-target="tagModal"]').forEach(el => {
        el.addEventListener('click', () => {
          this.hideTagModal();
        });
      });

      // 标签弹窗右上角 X 按钮关闭
      document.querySelector('#tagModal .close').addEventListener('click', () => {
        this.hideTagModal();
      });

     // 取消按钮
     document.getElementById('cancelAddTag').addEventListener('click', () => {
       this.hideTagModal();
     });

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
      console.log('deleteTag called with:', tag);
      console.log('Available tags before delete:', this.availableTags);
      
      // 统计有多少笔记包含这个标签
      const notesWithTag = this.notes.filter(note => note.tags.includes(tag));
      
      let confirmMsg = `确定要删除标签"${tag}"吗？`;
      if (notesWithTag.length > 0) {
        confirmMsg = `此标签被 ${notesWithTag.length} 个笔记使用。删除标签将同时删除这些笔记。确定继续吗？`;
      }
      
      if (confirm(confirmMsg)) {
        // 彻底删除包含此标签的所有笔记
        if (notesWithTag.length > 0) {
          this.notes = this.notes.filter(note => !note.tags.includes(tag));
        }

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
        
        // 立即重新渲染标签相关组件
        this.renderTagsWrapper();
        this.renderTags();
        this.filterNotes();
        this.renderNotes();
        this.renderCalendar();
        
        // 强制刷新标签包装器DOM
        requestAnimationFrame(() => {
          this.renderTagsWrapper();
          const wrapper = document.getElementById('tagsWrapper');
          if (wrapper) {
            wrapper.style.opacity = '0.99';
            wrapper.offsetHeight; // 强制重排
            wrapper.style.opacity = '';
          }
        });
        
        console.log('Available tags after delete:', this.availableTags);
        this.showToast(`标签"${tag}"已删除，相关笔记已彻底删除`);
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
         // 新建笔记，默认添加到当前分类
         const note = {
           id: Date.now(),
           title,
           content,
           tags,
           color: this.currentColor,
           category: this.currentCategory,
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

     // 处理前后带空格的连字符：&nbsp;-&nbsp;、 - 、&nbsp;-、-&nbsp;
     title = title.replace(/\s+-\s+/g, ' - ');

     // 去掉第一个 " - " 及其后面的所有内容
     const dashIndex = title.indexOf(' - ');
     if (dashIndex > -1) {
       title = title.substring(0, dashIndex);
     }
     title = title.trim();

     // 创建新笔记，默认添加到当前分类
     const newNote = {
       id: Date.now().toString(),
       title: title,
       content: url,
       tags: ['URL'],
       category: this.currentCategory,
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

     // 更严格的验证：如果启用云同步，所有字段都必须填写且不能为空
     if (enableCheckbox.checked) {
       if (!secretId) {
         alert('启用云同步时必须填写 SecretId');
         document.getElementById('syncSecretId').focus();
         return;
       }
       if (!secretKey) {
         alert('启用云同步时必须填写 SecretKey');
         document.getElementById('syncSecretKey').focus();
         return;
       }
       if (!bucket) {
         alert('启用云同步时必须填写存储桶名称');
         document.getElementById('syncBucket').focus();
         return;
       }
       if (!region) {
         alert('启用云同步时必须填写地域');
         document.getElementById('syncRegion').focus();
         return;
       }
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

     // 检查必要的配置字段是否都存在且不为空
     if (!result.cos_secretId || !result.cos_secretKey || !result.cos_bucket || !result.cos_region) {
       console.warn('云同步配置不完整，已自动禁用');
       // 自动禁用不完整的配置
       await chrome.storage.local.set({ cos_enabled: false });
       return null;
     }

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

   async uploadToCloud() {
     const config = await this.getCloudConfig();
     if (!config) {
       alert('请先启用并配置云同步');
       return;
     }

     // 详细检查配置参数
     console.log('Upload config:', config);
     if (!config.bucket) {
       alert('配置错误：Bucket 参数为空，请重新配置云同步');
       return;
     }
     if (!config.secretId) {
       alert('配置错误：SecretId 参数为空，请重新配置云同步');
       return;
     }
     if (!config.secretKey) {
       alert('配置错误：SecretKey 参数为空，请重新配置云同步');
       return;
     }
     if (!config.region) {
       alert('配置错误：Region 参数为空，请重新配置云同步');
       return;
     }

     if (typeof CloudSync === 'undefined') {
       alert('云同步模块未加载');
       return;
     }

     try {
       const sync = new CloudSync(config);
       await sync.upload(this.notes);
       this.showToast('已上传到云端');
     } catch (err) {
       console.error('Upload error details:', err);
       alert('上传失败: ' + err.message);
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

  updateLoadMoreButton() {
    // 创建加载提示元素
    let loadingIndicator = document.getElementById('loadingIndicator');

    if (this.renderedCount < this.filteredNotes.length) {
      if (!loadingIndicator) {
        loadingIndicator = document.createElement('div');
        loadingIndicator.id = 'loadingIndicator';
        loadingIndicator.className = 'loading-indicator';
        loadingIndicator.style.cssText = `
          text-align: center;
          padding: 20px;
          color: #999;
          font-size: 14px;
          display: none;
        `;
        loadingIndicator.textContent = '加载中...';
        document.getElementById('notesList').appendChild(loadingIndicator);
      }
      // 有更多笔记时，不显示任何提示，等待滚动触发
      loadingIndicator.style.display = 'none';
    } else {
      // 没有更多笔记，不显示提示
      if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
      }
    }
  }

  bindScrollEvent() {
    // 侧边栏环境中，滚动的是整个 body
    const scrollContainer = window;

    if (!scrollContainer) {
      return;
    }

    scrollContainer.addEventListener('scroll', () => {
      // 如果正在加载或已加载全部，不处理
      if (this.isLoading || this.renderedCount >= this.filteredNotes.length) {
        return;
      }

      // 计算滚动位置
      const scrollTop = window.scrollY || 0;
      const scrollHeight = document.documentElement.scrollHeight || 0;
      const clientHeight = window.innerHeight || 0;

      // 当滚动到距离底部150px时开始加载
      const threshold = 150;
      const distanceToBottom = scrollHeight - scrollTop - clientHeight;

      // 使用更宽松的条件：距离底部小于等于阈值时触发
      if (distanceToBottom <= threshold) {
        this.loadMoreNotes();
      }
    });
  }

  async loadMoreNotes() {
    if (this.isLoading) return;

    this.isLoading = true;

    const loadingIndicator = document.getElementById('loadingIndicator');
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


}

// 云同步模块将在HTML中通过script标签加载
// Initialize app
window.memosPlugin = new MemosPlugin();
