'use strict';

const APP_VERSION = 'v1.0.2';
const DB_NAME = 'omoidasimemo-db';
const DB_VERSION = 1;
const NOTE_STORE = 'notes';
const ITEM_STORE = 'items';

const defaultNoteCategories = ['スマホ', 'PC', '料理', '仕事', '生活', 'ChatGPT', 'その他'];
const defaultItemCategories = ['ガジェット', '家電', '工具', 'スポーツ', '防災', '書類', 'その他'];
const ownershipStatuses = ['所持中', '故障', '紛失・廃棄', '売却済み'];

let db;
let notes = [];
let items = [];
let currentView = 'home';
let searchQuery = '';
let activeCategory = '';
let activeTag = '';
let activeOwnershipStatus = '';
let itemSortMode = 'purchaseDesc';
let activeDetail = null;
let pendingImport = null;

const el = {};

document.addEventListener('DOMContentLoaded', async () => {
  cacheElements();
  bindEvents();
  await initDatabase();
  await loadAll();
  render();
  registerServiceWorker();
});

function cacheElements() {
  el.main = document.getElementById('appMain');
  el.search = document.getElementById('globalSearch');
  el.clearSearch = document.getElementById('clearSearchButton');
  el.addNote = document.getElementById('addNoteButton');
  el.addItem = document.getElementById('addItemButton');
  el.settings = document.getElementById('settingsButton');
  el.tabs = Array.from(document.querySelectorAll('.tab'));
  el.entryDialog = document.getElementById('entryDialog');
  el.entryForm = document.getElementById('entryForm');
  el.dialogTitle = document.getElementById('dialogTitle');
  el.formFields = document.getElementById('formFields');
  el.closeDialog = document.getElementById('closeDialogButton');
  el.cancelEntry = document.getElementById('cancelEntryButton');
  el.detailDialog = document.getElementById('detailDialog');
  el.detailTitle = document.getElementById('detailTitle');
  el.detailBody = document.getElementById('detailBody');
  el.closeDetail = document.getElementById('closeDetailButton');
  el.editEntry = document.getElementById('editEntryButton');
  el.deleteEntry = document.getElementById('deleteEntryButton');
  el.importDialog = document.getElementById('importDialog');
  el.importSummary = document.getElementById('importSummary');
  el.importFileInput = document.getElementById('importFileInput');
  el.closeImport = document.getElementById('closeImportButton');
  el.cancelImport = document.getElementById('cancelImportButton');
  el.mergeImport = document.getElementById('mergeImportButton');
  el.replaceImport = document.getElementById('replaceImportButton');
}

function bindEvents() {
  el.search.addEventListener('input', () => {
    searchQuery = el.search.value.trim();
    render();
  });

  el.clearSearch.addEventListener('click', () => {
    el.search.value = '';
    searchQuery = '';
    activeCategory = '';
    activeTag = '';
    activeOwnershipStatus = '';
    render();
  });

  el.addNote.addEventListener('click', () => openNoteForm());
  el.addItem.addEventListener('click', () => openItemForm());
  el.settings.addEventListener('click', () => setView('settings'));

  el.tabs.forEach((tab) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });

  el.closeDialog.addEventListener('click', closeEntryDialog);
  el.cancelEntry.addEventListener('click', closeEntryDialog);
  el.entryDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeEntryDialog();
  });

  el.closeDetail.addEventListener('click', closeDetailDialog);
  el.detailDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDetailDialog();
  });

  el.editEntry.addEventListener('click', () => {
    if (!activeDetail) return;
    const detailType = activeDetail.type;
    const detailId = activeDetail.id;
    const target = detailType === 'note'
      ? notes.find((note) => note.id === detailId)
      : items.find((item) => item.id === detailId);
    closeDetailDialog();
    if (!target) return;
    if (detailType === 'note') openNoteForm(target);
    if (detailType === 'item') openItemForm(target);
  });

  el.deleteEntry.addEventListener('click', async () => {
    if (!activeDetail) return;
    const label = activeDetail.type === 'note' ? '小ネタ' : '持ち物';
    const ok = window.confirm(`${label}を削除します。元に戻せません。よろしいですか？`);
    if (!ok) return;
    await deleteRecord(activeDetail.type === 'note' ? NOTE_STORE : ITEM_STORE, activeDetail.id);
    closeDetailDialog();
    await loadAll();
    render();
  });

  el.importFileInput.addEventListener('change', handleImportFile);
  el.closeImport.addEventListener('click', closeImportDialog);
  el.cancelImport.addEventListener('click', closeImportDialog);
  el.mergeImport.addEventListener('click', () => applyImport('merge'));
  el.replaceImport.addEventListener('click', () => applyImport('replace'));
  el.importDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeImportDialog();
  });
}

function initDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(NOTE_STORE)) {
        const noteStore = database.createObjectStore(NOTE_STORE, { keyPath: 'id' });
        noteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        noteStore.createIndex('category', 'category', { unique: false });
      }
      if (!database.objectStoreNames.contains(ITEM_STORE)) {
        const itemStore = database.createObjectStore(ITEM_STORE, { keyPath: 'id' });
        itemStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        itemStore.createIndex('category', 'category', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve();
    };

    request.onerror = () => reject(request.error);
  });
}

async function loadAll() {
  const [loadedNotes, loadedItems] = await Promise.all([getAllRecords(NOTE_STORE), getAllRecords(ITEM_STORE)]);
  notes = loadedNotes.map(normalizeNoteRecord).sort(sortByUpdatedDesc);
  items = loadedItems.map(normalizeItemRecord).sort(sortByUpdatedDesc);
}

function getAllRecords(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function putRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

function deleteRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function bulkPut(storeName, records) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    records.forEach((record) => store.put(record));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function setView(view) {
  currentView = view;
  el.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
  render();
  el.main.focus({ preventScroll: true });
}

function render() {
  el.main.innerHTML = '';
  if (currentView === 'home') renderHome();
  if (currentView === 'notes') renderNotesView();
  if (currentView === 'items') renderItemsView();
  if (currentView === 'settings') renderSettingsView();
}

function renderHome() {
  const allResults = getFilteredEntries('all');
  const favoriteEntries = [...notes.map(noteToEntry), ...items.map(itemToEntry)]
    .filter((entry) => entry.favorite)
    .sort(sortEntryByUpdatedDesc)
    .slice(0, 6);
  const recentEntries = [...notes.map(noteToEntry), ...items.map(itemToEntry)]
    .sort(sortEntryByUpdatedDesc)
    .slice(0, 6);
  const categoryCounts = countCategories([...notes, ...items]);
  const tagCounts = countTags([...notes, ...items]);

  el.main.append(
    createStatsPanel(),
    createHomeSearchResults(allResults),
    createEntrySection('よく見る', favoriteEntries, 'お気に入りにした小ネタ・持ち物を表示します。'),
    createEntrySection('最近更新', recentEntries, '最近登録または編集した内容です。'),
    createFilterPanel('カテゴリ', categoryCounts, 'category'),
    createFilterPanel('タグ', tagCounts, 'tag')
  );
}

function renderNotesView() {
  const entries = getFilteredEntries('note');
  el.main.append(createListHeader('小ネタ', `${entries.length}件表示 / 全${notes.length}件`, () => openNoteForm()));
  if (entries.length === 0) {
    el.main.append(createEmptyState('小ネタがありません', '手順・レシピ・操作方法などを登録してください。'));
    return;
  }
  el.main.append(createEntryList(entries));
}

function renderItemsView() {
  const entries = getFilteredEntries('item');
  el.main.append(
    createListHeader('持ち物', `${entries.length}件表示 / 全${items.length}件`, () => openItemForm()),
    createItemControls()
  );
  if (entries.length === 0) {
    el.main.append(createEmptyState('持ち物がありません', '型番・保証期限・保管場所などを登録してください。'));
    return;
  }
  el.main.append(createEntryList(entries));
}

function renderSettingsView() {
  const panel = createElement('section', 'panel');
  panel.innerHTML = `
    <div class="section-title-row">
      <div>
        <h2>設定・バックアップ</h2>
        <p>端末内保存です。ブラウザデータ削除に備えて、定期的にJSONバックアップを取ってください。</p>
      </div>
    </div>
  `;

  const stats = document.createElement('div');
  stats.className = 'stats-grid';
  stats.append(
    statCard(String(notes.length), '小ネタ'),
    statCard(String(items.length), '持ち物'),
    statCard(String(notes.length + items.length), '合計')
  );

  const actions = document.createElement('div');
  actions.className = 'settings-actions';

  const exportButton = button('保存先を選んでJSONを書き出す', 'save-button', exportBackupWithPicker);
  const shareButton = button('JSONを共有/ファイルに保存', 'ghost-button', shareBackup);
  const downloadButton = button('JSONをダウンロード', 'ghost-button', downloadBackup);
  const importButton = button('JSONから復元する', 'ghost-button', () => el.importFileInput.click());
  const sampleButton = button('サンプルデータを追加', 'ghost-button', addSampleData);
  const clearButton = button('全データ削除', 'ghost-button danger', clearAllData);

  actions.append(exportButton, shareButton, downloadButton, importButton, sampleButton, clearButton);

  const notice = createElement('div', 'notice');
  notice.innerHTML = `
    <strong>注意</strong><br>
    パスワード、クレジットカード番号、マイナンバーなどの機密情報は登録しないでください。写真もJSONバックアップに含まれます。
  `;

  panel.append(stats, document.createElement('br'), actions, document.createElement('br'), notice);
  el.main.append(panel);
}

function createStatsPanel() {
  const panel = createElement('section', 'panel');
  const titleRow = createElement('div', 'section-title-row');
  titleRow.innerHTML = `
    <div>
      <h2>ホーム</h2>
      <p>${searchQuery ? '検索条件に一致する内容を表示しています。' : '検索窓から小ネタと持ち物をまとめて探せます。'}</p>
    </div>
  `;

  const stats = createElement('div', 'stats-grid');
  stats.append(
    statCard(String(notes.length), '小ネタ'),
    statCard(String(items.length), '持ち物'),
    statCard(String(notes.length + items.length), '合計')
  );

  panel.append(titleRow, stats);
  return panel;
}

function createHomeSearchResults(entries) {
  if (!searchQuery && !activeCategory && !activeTag) {
    const panel = createElement('section', 'panel');
    panel.innerHTML = `
      <h2>使い方</h2>
      <p>忘れやすい手順は「小ネタ」、型番や保証期限は「持ち物」に分けて登録します。あとから曖昧な単語で検索できます。</p>
    `;
    return panel;
  }

  return createEntrySection('検索結果', entries, `${entries.length}件見つかりました。`);
}

function createEntrySection(title, entries, description) {
  const panel = createElement('section', 'panel');
  const header = createElement('div', 'section-title-row');
  header.innerHTML = `
    <div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(description || '')}</p>
    </div>
  `;
  panel.append(header);

  if (entries.length === 0) {
    panel.append(createSmallEmpty('表示できるデータがありません。'));
    return panel;
  }

  panel.append(createEntryList(entries));
  return panel;
}

function createEntryList(entries) {
  const list = createElement('div', 'card-list');
  entries.forEach((entry) => list.append(createEntryCard(entry)));
  return list;
}

function createEntryCard(entry) {
  const card = document.createElement('button');
  card.type = 'button';
  const shouldShowThumb = entry.type === 'item' || Boolean(entry.photo);
  card.className = shouldShowThumb ? 'card item-card-layout' : 'card';
  card.addEventListener('click', () => openDetail(entry.type, entry.id));

  if (shouldShowThumb) {
    const thumb = createEntryThumb(entry.photo, entry.title, entry.type === 'item' ? '物' : '画');
    const body = createElement('div');
    body.append(createCardBody(entry));
    card.append(thumb, body);
    return card;
  }

  card.append(createCardBody(entry));
  return card;
}

function createCardBody(entry) {
  const wrap = createElement('div');
  const top = createElement('div', 'card-top');
  const title = createElement('p', 'card-title', entry.title || '無題');
  const mark = createElement('span', 'favorite-mark', entry.favorite ? '★' : entry.type === 'note' ? '小ネタ' : '持ち物');
  top.append(title, mark);

  const metaParts = [entry.category, entry.meta].filter(Boolean);
  const meta = createElement('div', 'card-meta', metaParts.join(' / '));
  const preview = createElement('p', 'card-preview', entry.preview || '本文なし');
  const badges = createElement('div', 'badge-row');
  const typeBadge = createElement('span', 'badge', entry.type === 'note' ? '小ネタ' : '持ち物');
  badges.append(typeBadge);
  if (entry.type === 'item' && entry.ownershipStatus) {
    badges.append(createElement('span', `badge ${statusClass(entry.ownershipStatus)}`, entry.ownershipStatus));
  }
  entry.tags.slice(0, 4).forEach((tag) => badges.append(createElement('span', 'badge', `#${tag}`)));

  wrap.append(top, meta, preview, badges);
  return wrap;
}

function createEntryThumb(photo, title, fallbackLabel = '物') {
  if (!photo) return createElement('div', 'thumb-placeholder', fallbackLabel);
  const thumb = createElement('div', 'thumb');
  const img = document.createElement('img');
  img.src = photo;
  img.alt = `${title}の画像`;
  thumb.append(img);
  return thumb;
}

function createListHeader(title, subtitle, addHandler) {
  const panel = createElement('section', 'panel list-header');
  const text = document.createElement('div');
  text.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p>`;
  const add = button('＋ 追加', 'primary-action', addHandler);
  panel.append(text, add);
  return panel;
}

function createItemControls() {
  const panel = createElement('section', 'panel compact-panel');
  const statusOptions = ['<option value="">所持状況：すべて</option>', ...ownershipStatuses.map((status) => {
    const selected = activeOwnershipStatus === status ? 'selected' : '';
    return `<option value="${escapeAttr(status)}" ${selected}>所持状況：${escapeHtml(status)}</option>`;
  })].join('');

  const sortOptions = [
    ['purchaseDesc', '購入日 新しい順'],
    ['purchaseAsc', '購入日 古い順'],
    ['updatedDesc', '更新日 新しい順']
  ].map(([value, label]) => `<option value="${escapeAttr(value)}" ${itemSortMode === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');

  panel.innerHTML = `
    <div class="item-controls" aria-label="持ち物の絞り込みと並び替え">
      <div class="field compact-field">
        <label for="ownershipStatusFilter">所持状況</label>
        <select id="ownershipStatusFilter">${statusOptions}</select>
      </div>
      <div class="field compact-field">
        <label for="itemSortMode">並び替え</label>
        <select id="itemSortMode">${sortOptions}</select>
      </div>
    </div>
  `;

  panel.querySelector('#ownershipStatusFilter').addEventListener('change', (event) => {
    activeOwnershipStatus = event.target.value;
    render();
  });
  panel.querySelector('#itemSortMode').addEventListener('change', (event) => {
    itemSortMode = event.target.value;
    render();
  });
  return panel;
}

function createFilterPanel(title, counts, type) {
  const panel = createElement('section', 'panel');
  panel.innerHTML = `<h2>${escapeHtml(title)}</h2>`;
  const row = createElement('div', 'chip-row');
  const isClearActive = (type === 'category' && !activeCategory) || (type === 'tag' && !activeTag);
  const clear = button('すべて', `chip ${isClearActive ? 'active' : ''}`, () => {
    if (type === 'category') activeCategory = '';
    if (type === 'tag') activeTag = '';
    render();
  });
  row.append(clear);
  counts.slice(0, 20).forEach(({ name, count }) => {
    const isActive = type === 'category' ? activeCategory === name : activeTag === name;
    const chip = button(`${name} ${count}`, `chip ${isActive ? 'active' : ''}`, () => {
      if (type === 'category') activeCategory = isActive ? '' : name;
      if (type === 'tag') activeTag = isActive ? '' : name;
      render();
    });
    row.append(chip);
  });
  panel.append(row);
  return panel;
}

function createEmptyState(title, message) {
  const section = createElement('section', 'empty-state');
  section.innerHTML = `
    <div class="empty-icon">📝</div>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
  `;
  return section;
}

function createSmallEmpty(message) {
  return createElement('p', 'small-note', message);
}

function statCard(value, label) {
  const card = createElement('div', 'stat-card');
  card.innerHTML = `<strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span>`;
  return card;
}

function getFilteredEntries(type) {
  let entries = [];
  if (type === 'all' || type === 'note') entries.push(...notes.map(noteToEntry));
  if (type === 'all' || type === 'item') entries.push(...items.map(itemToEntry));

  const terms = normalize(searchQuery).split(/\s+/).filter(Boolean);
  entries = entries.filter((entry) => {
    const matchesQuery = terms.length === 0 || terms.every((term) => normalize(entry.searchText).includes(term));
    const matchesCategory = !activeCategory || entry.category === activeCategory;
    const matchesTag = !activeTag || entry.tags.includes(activeTag);
    const matchesOwnership = type !== 'item' || !activeOwnershipStatus || entry.ownershipStatus === activeOwnershipStatus;
    return matchesQuery && matchesCategory && matchesTag && matchesOwnership;
  });

  return type === 'item' ? entries.sort(sortItemEntries) : entries.sort(sortEntryByUpdatedDesc);
}

function noteToEntry(note) {
  return {
    id: note.id,
    type: 'note',
    title: note.title || '無題の小ネタ',
    category: note.category || 'その他',
    tags: Array.isArray(note.tags) ? note.tags : [],
    favorite: Boolean(note.favorite),
    meta: formatDate(note.updatedAt),
    preview: firstText(note.body, note.steps, note.caution),
    updatedAt: note.updatedAt,
    photo: note.photo || '',
    searchText: [note.title, note.category, joinTags(note.tags), note.body, note.steps, note.caution, note.url].join(' ')
  };
}

function itemToEntry(item) {
  const ownershipStatus = getOwnershipStatus(item);
  return {
    id: item.id,
    type: 'item',
    title: item.name || '無題の持ち物',
    category: item.category || 'その他',
    tags: Array.isArray(item.tags) ? item.tags : [],
    favorite: Boolean(item.favorite),
    ownershipStatus,
    purchaseDate: item.purchaseDate || '',
    meta: [item.maker, item.modelNumber, item.storagePlace ? `保管：${item.storagePlace}` : ''].filter(Boolean).join(' / '),
    preview: [
      item.purchaseDate ? `購入日：${item.purchaseDate}` : '',
      item.warrantyUntil ? `保証：${item.warrantyUntil}` : '',
      `状態：${ownershipStatus}`,
      item.freeMemo,
      item.consumablesMemo
    ].filter(Boolean).join('　') || 'メモなし',
    updatedAt: item.updatedAt,
    photo: item.photo || '',
    searchText: [
      item.name,
      item.category,
      ownershipStatus,
      item.maker,
      item.modelNumber,
      item.shop,
      item.storagePlace,
      item.manualUrl,
      item.consumablesMemo,
      item.freeMemo,
      joinTags(item.tags),
      item.purchaseDate,
      item.warrantyUntil
    ].join(' ')
  };
}

function openNoteForm(existing = null) {
  const isEdit = Boolean(existing);
  el.dialogTitle.textContent = isEdit ? '小ネタを編集' : '小ネタを追加';
  const currentPhoto = existing?.photo || '';
  el.formFields.innerHTML = `
    <div class="field">
      <label for="notePhoto">画像</label>
      <input id="notePhoto" name="photo" type="file" accept="image/*">
      <img id="notePhotoPreview" class="image-preview" alt="画像プレビュー">
      ${currentPhoto ? '<label class="check-row"><input type="checkbox" name="removePhoto">画像を削除する</label>' : ''}
    </div>
    ${field('title', 'タイトル', 'text', existing?.title || '', '例：iPhoneの完全再起動', true)}
    ${selectField('category', 'カテゴリ', existing?.category || 'その他', defaultNoteCategories)}
    ${field('tags', 'タグ（スペース・カンマ区切り）', 'text', joinTags(existing?.tags), '例：iPhone 再起動 不具合対応')}
    ${textareaField('body', '本文', existing?.body || '', '概要や結論を入れます')}
    ${textareaField('steps', '手順', existing?.steps || '', '1. ...\n2. ...')}
    ${textareaField('caution', '注意点', existing?.caution || '', '失敗しやすい点、条件など')}
    ${field('url', '参考URL', 'url', existing?.url || '', 'https://...')}
    ${checkField('favorite', 'お気に入り', Boolean(existing?.favorite))}
  `;

  const photoInput = el.formFields.querySelector('#notePhoto');
  const photoPreview = el.formFields.querySelector('#notePhotoPreview');
  if (currentPhoto) {
    photoPreview.src = currentPhoto;
    photoPreview.style.display = 'block';
  }
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    const dataUrl = await resizeImageToDataUrl(file, 1280, 0.82);
    photoPreview.src = dataUrl;
    photoPreview.style.display = 'block';
  });

  el.entryForm.onsubmit = async (event) => {
    event.preventDefault();
    const now = nowIso();
    const form = new FormData(el.entryForm);
    let photo = currentPhoto;
    if (form.get('removePhoto') === 'on') photo = '';
    if (photoInput.files?.[0]) photo = await resizeImageToDataUrl(photoInput.files[0], 1280, 0.82);

    const record = {
      id: existing?.id || createId('note'),
      type: 'note',
      title: String(form.get('title') || '').trim(),
      category: String(form.get('category') || 'その他').trim() || 'その他',
      tags: parseTags(form.get('tags')),
      photo,
      body: String(form.get('body') || '').trim(),
      steps: String(form.get('steps') || '').trim(),
      caution: String(form.get('caution') || '').trim(),
      url: String(form.get('url') || '').trim(),
      favorite: form.get('favorite') === 'on',
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await putRecord(NOTE_STORE, record);
    closeEntryDialog();
    await loadAll();
    currentView = 'notes';
    updateTabs();
    render();
  };
  showDialog(el.entryDialog);
}

function openItemForm(existing = null) {
  const isEdit = Boolean(existing);
  el.dialogTitle.textContent = isEdit ? '持ち物を編集' : '持ち物を追加';
  const currentPhoto = existing?.photo || '';
  el.formFields.innerHTML = `
    <div class="field">
      <label for="photo">写真</label>
      <input id="photo" name="photo" type="file" accept="image/*">
      <img id="photoPreview" class="image-preview" alt="写真プレビュー">
      ${currentPhoto ? '<label class="check-row"><input type="checkbox" name="removePhoto">写真を削除する</label>' : ''}
    </div>
    ${field('name', '品名', 'text', existing?.name || '', '例：モバイルバッテリー', true)}
    ${selectField('category', 'カテゴリ', existing?.category || 'その他', defaultItemCategories)}
    ${fixedSelectField('ownershipStatus', '所持状況', getOwnershipStatus(existing), ownershipStatuses)}
    <div class="two-cols">
      ${field('maker', 'メーカー', 'text', existing?.maker || '', '例：Anker')}
      ${field('modelNumber', '型番', 'text', existing?.modelNumber || '', '例：Axxxx')}
    </div>
    <div class="two-cols">
      ${field('purchaseDate', '購入日', 'date', existing?.purchaseDate || '', '')}
      ${field('warrantyUntil', '保証期限', 'date', existing?.warrantyUntil || '', '')}
    </div>
    <div class="two-cols">
      ${field('shop', '購入店', 'text', existing?.shop || '', '例：Amazon')}
      ${field('price', '価格', 'number', existing?.price || '', '例：3980')}
    </div>
    ${field('storagePlace', '保管場所', 'text', existing?.storagePlace || '', '例：仕事カバン')}
    ${field('manualUrl', '説明書URL', 'url', existing?.manualUrl || '', 'https://...')}
    ${textareaField('consumablesMemo', '消耗品メモ', existing?.consumablesMemo || '', '交換品、付属品、ケーブルなど')}
    ${textareaField('freeMemo', '自由メモ', existing?.freeMemo || '', '用途、注意点、使用感など')}
    ${field('tags', 'タグ（スペース・カンマ区切り）', 'text', joinTags(existing?.tags), '例：充電 防災 出張')}
    ${checkField('favorite', 'お気に入り', Boolean(existing?.favorite))}
  `;

  const photoInput = el.formFields.querySelector('#photo');
  const photoPreview = el.formFields.querySelector('#photoPreview');
  if (currentPhoto) {
    photoPreview.src = currentPhoto;
    photoPreview.style.display = 'block';
  }
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    const dataUrl = await resizeImageToDataUrl(file, 1280, 0.82);
    photoPreview.src = dataUrl;
    photoPreview.style.display = 'block';
  });

  el.entryForm.onsubmit = async (event) => {
    event.preventDefault();
    const now = nowIso();
    const form = new FormData(el.entryForm);
    let photo = currentPhoto;
    if (form.get('removePhoto') === 'on') photo = '';
    if (photoInput.files?.[0]) photo = await resizeImageToDataUrl(photoInput.files[0], 1280, 0.82);

    const record = {
      id: existing?.id || createId('item'),
      type: 'item',
      name: String(form.get('name') || '').trim(),
      category: String(form.get('category') || 'その他').trim() || 'その他',
      ownershipStatus: getValidOwnershipStatus(form.get('ownershipStatus')),
      maker: String(form.get('maker') || '').trim(),
      modelNumber: String(form.get('modelNumber') || '').trim(),
      photo,
      purchaseDate: String(form.get('purchaseDate') || '').trim(),
      shop: String(form.get('shop') || '').trim(),
      price: form.get('price') ? Number(form.get('price')) : '',
      warrantyUntil: String(form.get('warrantyUntil') || '').trim(),
      storagePlace: String(form.get('storagePlace') || '').trim(),
      manualUrl: String(form.get('manualUrl') || '').trim(),
      consumablesMemo: String(form.get('consumablesMemo') || '').trim(),
      freeMemo: String(form.get('freeMemo') || '').trim(),
      tags: parseTags(form.get('tags')),
      favorite: form.get('favorite') === 'on',
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await putRecord(ITEM_STORE, record);
    closeEntryDialog();
    await loadAll();
    currentView = 'items';
    updateTabs();
    render();
  };
  showDialog(el.entryDialog);
}

function openDetail(type, id) {
  activeDetail = { type, id };
  const record = type === 'note' ? notes.find((note) => note.id === id) : items.find((item) => item.id === id);
  if (!record) return;
  if (type === 'note') renderNoteDetail(record);
  if (type === 'item') renderItemDetail(record);
  showDialog(el.detailDialog);
}

function renderNoteDetail(note) {
  el.detailTitle.textContent = note.title || '無題の小ネタ';
  el.detailBody.innerHTML = '';
  if (note.photo) {
    const img = document.createElement('img');
    img.className = 'photo-large';
    img.src = note.photo;
    img.alt = `${note.title || '小ネタ'}の画像`;
    el.detailBody.append(img);
  }
  el.detailBody.append(
    detailBadges(note.category, note.tags, note.favorite),
    detailText('本文', note.body),
    detailText('手順', note.steps),
    detailText('注意点', note.caution),
    detailLink('参考URL', note.url),
    detailTable([
      ['登録日', formatDateTime(note.createdAt)],
      ['更新日', formatDateTime(note.updatedAt)]
    ])
  );
}

function renderItemDetail(item) {
  el.detailTitle.textContent = item.name || '無題の持ち物';
  el.detailBody.innerHTML = '';
  if (item.photo) {
    const img = document.createElement('img');
    img.className = 'photo-large';
    img.src = item.photo;
    img.alt = `${item.name || '持ち物'}の写真`;
    el.detailBody.append(img);
  }
  el.detailBody.append(
    detailBadges(item.category, item.tags, item.favorite, getOwnershipStatus(item)),
    detailTable([
      ['所持状況', getOwnershipStatus(item)],
      ['メーカー', item.maker],
      ['型番', item.modelNumber],
      ['購入日', item.purchaseDate],
      ['購入店', item.shop],
      ['価格', formatPrice(item.price)],
      ['保証期限', item.warrantyUntil],
      ['保管場所', item.storagePlace],
      ['説明書URL', item.manualUrl ? linkHtml(item.manualUrl) : ''],
      ['登録日', formatDateTime(item.createdAt)],
      ['更新日', formatDateTime(item.updatedAt)]
    ], true),
    detailText('消耗品メモ', item.consumablesMemo),
    detailText('自由メモ', item.freeMemo)
  );
}

function detailBadges(category, tags, favorite, ownershipStatus = '') {
  const section = createElement('div', 'detail-section');
  const row = createElement('div', 'badge-row');
  row.append(createElement('span', 'badge', category || 'その他'));
  if (ownershipStatus) row.append(createElement('span', `badge ${statusClass(ownershipStatus)}`, ownershipStatus));
  if (favorite) row.append(createElement('span', 'badge', '★ お気に入り'));
  (tags || []).forEach((tag) => row.append(createElement('span', 'badge', `#${tag}`)));
  section.append(row);
  return section;
}

function detailText(title, text) {
  const section = createElement('section', 'detail-section');
  section.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
  const pre = document.createElement('pre');
  pre.textContent = text || '未登録';
  section.append(pre);
  return section;
}

function detailLink(title, url) {
  const section = createElement('section', 'detail-section');
  section.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
  if (!url) {
    section.append(createElement('p', '', '未登録'));
    return section;
  }
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = url;
  section.append(a);
  return section;
}

function detailTable(rows, allowHtml = false) {
  const table = document.createElement('table');
  table.className = 'detail-table';
  const tbody = document.createElement('tbody');
  rows.forEach(([key, value]) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    const td = document.createElement('td');
    th.textContent = key;
    if (allowHtml && typeof value === 'string' && value.startsWith('<a ')) {
      td.innerHTML = value;
    } else {
      td.textContent = value || '未登録';
    }
    tr.append(th, td);
    tbody.append(tr);
  });
  table.append(tbody);
  return table;
}

function closeEntryDialog() {
  el.entryForm.reset();
  el.entryForm.onsubmit = null;
  el.formFields.innerHTML = '';
  closeDialog(el.entryDialog);
}

function closeDetailDialog() {
  activeDetail = null;
  el.detailBody.innerHTML = '';
  closeDialog(el.detailDialog);
}

function closeImportDialog() {
  pendingImport = null;
  el.importSummary.innerHTML = '';
  el.importFileInput.value = '';
  closeDialog(el.importDialog);
}

function createBackupFileParts() {
  const filename = `omoidasimemo-backup-${dateStamp()}.json`;
  const payload = {
    app: '思い出しメモ',
    version: APP_VERSION,
    exportedAt: nowIso(),
    notes,
    items
  };
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  return { filename, text, blob };
}

async function exportBackupWithPicker() {
  const { filename, blob } = createBackupFileParts();
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'JSONバックアップ',
            accept: { 'application/json': ['.json'] }
          }
        ]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      window.alert('JSONバックアップを保存しました。');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  await shareBackup();
}

async function shareBackup() {
  const { filename, blob } = createBackupFileParts();
  if (typeof File === 'function') {
    const file = new File([blob], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({
          title: '思い出しメモ バックアップ',
          text: '思い出しメモのJSONバックアップです。',
          files: [file]
        });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
  }
  downloadBackup();
}

function downloadBackup() {
  const { filename, blob } = createBackupFileParts();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const normalized = normalizeImportData(data);
    pendingImport = normalized;
    el.importSummary.innerHTML = `
      <section class="detail-section">
        <h3>読み込み内容</h3>
        <p>小ネタ：${normalized.notes.length}件<br>持ち物：${normalized.items.length}件</p>
      </section>
      <section class="detail-section">
        <h3>復元方法</h3>
        <p><strong>追加で復元</strong>：既存データを残して読み込みます。<br><strong>全消去して復元</strong>：今のデータを削除してから読み込みます。</p>
      </section>
    `;
    showDialog(el.importDialog);
  } catch (error) {
    window.alert(`JSONを読み込めませんでした。\n${error.message}`);
    el.importFileInput.value = '';
  }
}

function normalizeImportData(data) {
  if (!data || typeof data !== 'object') throw new Error('バックアップ形式が不正です。');
  const importedNotes = Array.isArray(data.notes) ? data.notes : [];
  const importedItems = Array.isArray(data.items) ? data.items : [];
  const now = nowIso();
  return {
    notes: importedNotes.map((note) => ({
      id: String(note.id || createId('note')),
      type: 'note',
      title: String(note.title || '').trim(),
      category: String(note.category || 'その他').trim() || 'その他',
      tags: Array.isArray(note.tags) ? note.tags.map(String).filter(Boolean) : parseTags(note.tags),
      photo: String(note.photo || ''),
      body: String(note.body || '').trim(),
      steps: String(note.steps || '').trim(),
      caution: String(note.caution || '').trim(),
      url: String(note.url || '').trim(),
      favorite: Boolean(note.favorite),
      createdAt: note.createdAt || now,
      updatedAt: note.updatedAt || now
    })),
    items: importedItems.map((item) => ({
      id: String(item.id || createId('item')),
      type: 'item',
      name: String(item.name || '').trim(),
      category: String(item.category || 'その他').trim() || 'その他',
      ownershipStatus: getValidOwnershipStatus(item.ownershipStatus || item.status || item.condition),
      maker: String(item.maker || '').trim(),
      modelNumber: String(item.modelNumber || '').trim(),
      photo: String(item.photo || ''),
      purchaseDate: String(item.purchaseDate || '').trim(),
      shop: String(item.shop || '').trim(),
      price: item.price || '',
      warrantyUntil: String(item.warrantyUntil || '').trim(),
      storagePlace: String(item.storagePlace || '').trim(),
      manualUrl: String(item.manualUrl || '').trim(),
      consumablesMemo: String(item.consumablesMemo || '').trim(),
      freeMemo: String(item.freeMemo || '').trim(),
      tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : parseTags(item.tags),
      favorite: Boolean(item.favorite),
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || now
    }))
  };
}

async function applyImport(mode) {
  if (!pendingImport) return;
  if (mode === 'replace') {
    const ok = window.confirm('現在の全データを削除してから復元します。よろしいですか？');
    if (!ok) return;
    await Promise.all([clearStore(NOTE_STORE), clearStore(ITEM_STORE)]);
  }
  if (mode === 'merge') {
    pendingImport.notes = pendingImport.notes.map((note) => ({ ...note, id: createId('note') }));
    pendingImport.items = pendingImport.items.map((item) => ({ ...item, id: createId('item') }));
  }
  await Promise.all([bulkPut(NOTE_STORE, pendingImport.notes), bulkPut(ITEM_STORE, pendingImport.items)]);
  closeImportDialog();
  await loadAll();
  render();
}

async function addSampleData() {
  const ok = window.confirm('動作確認用のサンプルを追加します。よろしいですか？');
  if (!ok) return;
  const now = nowIso();
  await putRecord(NOTE_STORE, {
    id: createId('note'),
    type: 'note',
    title: 'iPhoneの完全再起動',
    category: 'スマホ',
    tags: ['iPhone', '再起動', '不具合対応'],
    photo: '',
    body: 'iPhoneが固まった時に強制的に再起動する方法。',
    steps: '1. 音量上を押してすぐ離す\n2. 音量下を押してすぐ離す\n3. サイドボタンをAppleロゴが出るまで長押し',
    caution: '通常の電源オフとは違う。機種によって操作が異なる場合は公式情報を確認する。',
    url: '',
    favorite: true,
    createdAt: now,
    updatedAt: now
  });
  await putRecord(ITEM_STORE, {
    id: createId('item'),
    type: 'item',
    name: 'モバイルバッテリー',
    category: 'ガジェット',
    maker: 'Anker',
    modelNumber: 'Axxxx',
    photo: '',
    ownershipStatus: '所持中',
    purchaseDate: '2026-06-01',
    shop: 'Amazon',
    price: '',
    warrantyUntil: '',
    storagePlace: '仕事カバン',
    manualUrl: '',
    consumablesMemo: 'USB-Cケーブルとセットで保管。',
    freeMemo: '出張・防災用にも使う。',
    tags: ['充電', '防災', '出張'],
    favorite: true,
    createdAt: now,
    updatedAt: now
  });
  await loadAll();
  render();
}

async function clearAllData() {
  const ok = window.confirm('全データを削除します。バックアップがない場合は戻せません。よろしいですか？');
  if (!ok) return;
  await Promise.all([clearStore(NOTE_STORE), clearStore(ITEM_STORE)]);
  await loadAll();
  render();
}

function field(name, label, type, value, placeholder = '', required = false) {
  const requiredAttr = required ? 'required' : '';
  return `
    <div class="field">
      <label for="${escapeAttr(name)}">${escapeHtml(label)}</label>
      <input id="${escapeAttr(name)}" name="${escapeAttr(name)}" type="${escapeAttr(type)}" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" ${requiredAttr}>
    </div>
  `;
}

function textareaField(name, label, value, placeholder = '') {
  return `
    <div class="field">
      <label for="${escapeAttr(name)}">${escapeHtml(label)}</label>
      <textarea id="${escapeAttr(name)}" name="${escapeAttr(name)}" placeholder="${escapeAttr(placeholder)}">${escapeHtml(value)}</textarea>
    </div>
  `;
}

function selectField(name, label, value, options) {
  const listId = `${name}List_${Math.random().toString(36).slice(2)}`;
  const optionHtml = options.map((option) => `<option value="${escapeAttr(option)}"></option>`).join('');
  return `
    <div class="field">
      <label for="${escapeAttr(name)}">${escapeHtml(label)}</label>
      <input id="${escapeAttr(name)}" name="${escapeAttr(name)}" type="text" value="${escapeAttr(value)}" list="${escapeAttr(listId)}" placeholder="例：${escapeAttr(options[0] || 'その他')}">
      <datalist id="${escapeAttr(listId)}">${optionHtml}</datalist>
    </div>
  `;
}

function fixedSelectField(name, label, value, options) {
  const currentValue = options.includes(value) ? value : options[0];
  const optionHtml = options
    .map((option) => `<option value="${escapeAttr(option)}" ${option === currentValue ? 'selected' : ''}>${escapeHtml(option)}</option>`)
    .join('');
  return `
    <div class="field">
      <label for="${escapeAttr(name)}">${escapeHtml(label)}</label>
      <select id="${escapeAttr(name)}" name="${escapeAttr(name)}">${optionHtml}</select>
    </div>
  `;
}

function checkField(name, label, checked) {
  return `
    <label class="check-row">
      <input type="checkbox" name="${escapeAttr(name)}" ${checked ? 'checked' : ''}>
      ${escapeHtml(label)}
    </label>
  `;
}

function button(label, className, handler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', handler);
  return btn;
}

function createElement(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function parseTags(input) {
  if (!input) return [];
  return String(input)
    .split(/[、,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, array) => array.indexOf(tag) === index);
}

function joinTags(tags) {
  return Array.isArray(tags) ? tags.join(' ') : '';
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKC');
}


function normalizeNoteRecord(note) {
  return {
    ...note,
    photo: String(note?.photo || '')
  };
}

function getValidOwnershipStatus(value) {
  const status = String(value || '').trim();
  return ownershipStatuses.includes(status) ? status : '所持中';
}

function getOwnershipStatus(item) {
  return getValidOwnershipStatus(item?.ownershipStatus);
}

function normalizeItemRecord(item) {
  return {
    ...item,
    ownershipStatus: getOwnershipStatus(item)
  };
}

function sortItemEntries(a, b) {
  if (itemSortMode === 'purchaseAsc') return comparePurchaseDate(a, b, 'asc');
  if (itemSortMode === 'updatedDesc') return sortEntryByUpdatedDesc(a, b);
  return comparePurchaseDate(a, b, 'desc');
}

function comparePurchaseDate(a, b, direction) {
  const aDate = normalizeDateForSort(a.purchaseDate);
  const bDate = normalizeDateForSort(b.purchaseDate);
  if (!aDate && !bDate) return sortEntryByUpdatedDesc(a, b);
  if (!aDate) return 1;
  if (!bDate) return -1;
  const primary = direction === 'asc' ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate);
  return primary || sortEntryByUpdatedDesc(a, b);
}

function normalizeDateForSort(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function statusClass(status) {
  if (status === '故障') return 'status-broken';
  if (status === '紛失・廃棄') return 'status-disposed';
  if (status === '売却済み') return 'status-sold';
  return 'status-owned';
}

function firstText(...values) {
  const text = values.find((value) => String(value || '').trim());
  if (!text) return '';
  const oneLine = String(text).replace(/\s+/g, ' ').trim();
  return oneLine.length > 92 ? `${oneLine.slice(0, 92)}...` : oneLine;
}

function sortByUpdatedDesc(a, b) {
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

function sortEntryByUpdatedDesc(a, b) {
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

function countCategories(records) {
  const map = new Map();
  records.forEach((record) => {
    const category = record.category || 'その他';
    map.set(category, (map.get(category) || 0) + 1);
  });
  return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
}

function countTags(records) {
  const map = new Map();
  records.forEach((record) => {
    (record.tags || []).forEach((tag) => map.set(tag, (map.get(tag) || 0) + 1));
  });
  return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
}

function createId(prefix) {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
}

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

function formatPrice(price) {
  if (price === '' || price === null || price === undefined) return '';
  const num = Number(price);
  if (Number.isNaN(num)) return String(price);
  return `${num.toLocaleString('ja-JP')}円`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function linkHtml(url) {
  const safeUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(safeUrl)) return escapeHtml(safeUrl);
  return `<a href="${escapeAttr(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeUrl)}</a>`;
}

function updateTabs() {
  el.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === currentView));
}

function showDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

function resizeImageToDataUrl(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像を読み込めませんでした。'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Service Worker is optional. The app still works without it.
  });
}
