import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.NL_CONFIG || {};
const configured = config.supabaseUrl && !config.supabaseUrl.startsWith('YOUR_') && config.supabaseAnonKey && !config.supabaseAnonKey.startsWith('YOUR_');
const supabase = configured ? createClient(config.supabaseUrl, config.supabaseAnonKey) : null;
let currentUser = null;
let marketKind = 'config';
let marketItems = [];
let installDirectory = null;
let cloudItems = [];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const authModal = $('#authModal');
const infoModal = $('#infoModal');
const message = $('#formMessage');

function route() {
  const raw = location.hash.replace('#', '') || 'home';
  const page = ['home', 'forum', 'market', 'help', 'account'].includes(raw) ? raw : 'home';
  $$('.page').forEach((node) => node.classList.toggle('active', node.dataset.page === page));
  $$('[data-route]').forEach((node) => node.classList.toggle('active', node.dataset.route === page));
  if (page === 'account' && !currentUser) {
    location.hash = '#home';
    openAuth('login');
  }
  if (page === 'market') loadMarket();
  if (page === 'account' && currentUser) loadMyCloud();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function marketCard(item) {
  const safeTitle = String(item.title || '').replace(/[<>]/g, '');
  const safeDescription = String(item.description || '').replace(/[<>]/g, '');
  return `<article class="market-card"><div class="market-card-top"><span class="file-badge">${item.kind === 'lua' ? 'LUA' : 'CFG'}</span><span>${new Date(item.created_at).toLocaleDateString('ru-RU')}</span></div><h3>${safeTitle}</h3><p>${safeDescription}</p><div class="market-card-foot"><span>↓ ${Number(item.downloads || 0)}</span><div class="card-actions"><button class="download-button" data-download-id="${item.id}" data-path="${item.storage_path}" title="Скачать файл">↓</button><button class="install-button" data-install-id="${item.id}">Установить</button></div></div></article>`;
}

function renderMarket() {
  const query = $('#marketSearch').value.trim().toLowerCase();
  const list = marketItems.filter((item) => item.kind === marketKind && (`${item.title} ${item.description}`).toLowerCase().includes(query));
  $('#marketGrid').innerHTML = list.map(marketCard).join('');
  $('#marketCount').textContent = `${list.length} ${list.length === 1 ? 'материал' : 'материалов'}`;
  $('#marketEmpty').classList.toggle('hidden', list.length !== 0);
  $$('[data-download-id]').forEach((button) => button.addEventListener('click', () => downloadMarketItem(button)));
  $$('[data-install-id]').forEach((button) => button.addEventListener('click', () => installMarketItem(button)));
}

function openInstallDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('aero-nl-cloud', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rememberDirectory(handle) {
  const db = await openInstallDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction('handles', 'readwrite').objectStore('handles').put(handle, 'nl-cloud');
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function restoreDirectory() {
  if (!('showDirectoryPicker' in window)) {
    $('#folderStatus').textContent = 'Установка поддерживается в Chrome/Edge';
    $('#connectFolderButton').disabled = true;
    return;
  }
  try {
    const db = await openInstallDb();
    installDirectory = await new Promise((resolve, reject) => {
      const request = db.transaction('handles').objectStore('handles').get('nl-cloud');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch (_) {
    installDirectory = null;
  }
  updateFolderStatus();
}

function updateFolderStatus() {
  $('#folderStatus').textContent = installDirectory ? `Подключено: ${installDirectory.name}` : 'Папка установки не выбрана';
  $('#connectFolderButton').textContent = installDirectory ? 'Сменить папку' : 'Подключить NL Cloud';
}

async function connectInstallFolder() {
  if (!('showDirectoryPicker' in window)) return showToast('Откройте сайт в Chrome или Edge для прямой установки');
  try {
    installDirectory = await window.showDirectoryPicker({ id: 'neverlose-cloud', mode: 'readwrite' });
    await rememberDirectory(installDirectory);
    updateFolderStatus();
    showToast('NL Cloud подключён. Теперь доступна установка в один клик');
    return installDirectory;
  } catch (error) {
    if (error.name !== 'AbortError') showToast(`Не удалось подключить папку: ${error.message}`);
    return null;
  }
}

async function ensureDirectoryPermission(handle) {
  const options = { mode: 'readwrite' };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  return (await handle.requestPermission(options)) === 'granted';
}

async function installMarketItem(button) {
  if (!currentUser) return openAuth('login');
  if (!supabase) return showToast('Подключите Supabase для установки материалов');
  const item = marketItems.find((entry) => Number(entry.id) === Number(button.dataset.installId));
  if (!item) return showToast('Материал не найден');
  let root = installDirectory;
  if (!root) root = await connectInstallFolder();
  if (!root || !(await ensureDirectoryPermission(root))) return showToast('Нужен доступ к папке nl_cloud');

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Установка…';
  try {
    const { data: blob, error } = await supabase.storage.from('market').download(item.storage_path);
    if (error) throw error;
    const folderName = item.kind === 'lua' ? 'scripts' : 'configs';
    const folder = await root.getDirectoryHandle(folderName, { create: true });
    const fallback = `${item.title}.${item.kind === 'lua' ? 'lua' : 'cfg'}`;
    const safeName = String(item.file_name || fallback).replace(/[^a-zA-Z0-9а-яА-ЯёЁ._ -]/g, '_');
    const file = await folder.getFileHandle(safeName, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    await supabase.rpc('increment_market_download', { item_id: Number(item.id) });
    item.downloads = Number(item.downloads || 0) + 1;
    button.textContent = 'Установлено ✓';
    showToast(`${item.kind === 'lua' ? 'Lua' : 'Конфиг'} установлен в ${root.name}/${folderName}`);
  } catch (error) {
    button.textContent = originalText;
    showToast(`Ошибка установки: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

async function loadMarket() {
  if (!supabase) {
    marketItems = [
      { id: 1, kind: 'config', title: 'Rage Universal', description: 'Сбалансированный облачный конфиг для CS2.', downloads: 248, storage_path: '', created_at: new Date().toISOString() },
      { id: 2, kind: 'lua', title: 'Adaptive Indicators', description: 'Компактные индикаторы состояния и биндов.', downloads: 117, storage_path: '', created_at: new Date().toISOString() }
    ]; renderMarket(); return;
  }
  const { data, error } = await supabase.from('market_items').select('*').eq('published', true).order('created_at', { ascending: false });
  if (error) return showToast(error.message);
  marketItems = data || []; renderMarket();
}

async function downloadMarketItem(button) {
  if (!currentUser) return openAuth('login');
  if (!supabase || !button.dataset.path) return showToast('Демо-материал станет доступен после подключения облака');
  const { data, error } = await supabase.storage.from('market').createSignedUrl(button.dataset.path, 60);
  if (error) return showToast(error.message);
  await supabase.rpc('increment_market_download', { item_id: Number(button.dataset.downloadId) });
  location.href = data.signedUrl;
}

function formatBytes(bytes) {
  if (!bytes) return '0 Б';
  const units = ['Б', 'КБ', 'МБ'];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function cloudCard(item) {
  const title = String(item.title || '').replace(/[<>]/g, '');
  return `<article class="cloud-row"><span class="file-badge">${item.kind === 'lua' ? 'LUA' : 'CFG'}</span><div><strong>${title}</strong><small>${item.published ? 'Опубликован в Market' : 'Приватный файл'} · ${formatBytes(item.file_size)}</small></div><button data-cloud-install="${item.id}">Установить</button><button class="danger-button" data-cloud-delete="${item.id}">Удалить</button></article>`;
}

function renderMyCloud() {
  $('#cloudList').innerHTML = cloudItems.map(cloudCard).join('');
  $('#cloudEmpty').classList.toggle('hidden', cloudItems.length > 0);
  $('#cloudCount').textContent = `${cloudItems.length} файлов`;
  $('#cloudUsage').textContent = `${formatBytes(cloudItems.reduce((sum, item) => sum + Number(item.file_size || 0), 0))} использовано`;
  $$('[data-cloud-install]').forEach((button) => button.addEventListener('click', () => {
    const item = cloudItems.find((entry) => Number(entry.id) === Number(button.dataset.cloudInstall));
    if (!item) return;
    if (!marketItems.some((entry) => Number(entry.id) === Number(item.id))) marketItems.push(item);
    button.dataset.installId = item.id;
    installMarketItem(button);
  }));
  $$('[data-cloud-delete]').forEach((button) => button.addEventListener('click', () => deleteCloudItem(button)));
}

async function loadMyCloud() {
  if (!currentUser || !supabase) { cloudItems = []; renderMyCloud(); return; }
  const { data, error } = await supabase.from('market_items').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if (error) return showToast(error.message);
  cloudItems = data || [];
  renderMyCloud();
}

async function deleteCloudItem(button) {
  const item = cloudItems.find((entry) => Number(entry.id) === Number(button.dataset.cloudDelete));
  if (!item || !confirm(`Удалить «${item.title}» из облака?`)) return;
  button.disabled = true;
  const removedFile = await supabase.storage.from('market').remove([item.storage_path]);
  if (removedFile.error) { button.disabled = false; return showToast(removedFile.error.message); }
  const removedRow = await supabase.from('market_items').delete().eq('id', item.id).eq('user_id', currentUser.id);
  if (removedRow.error) { button.disabled = false; return showToast(removedRow.error.message); }
  cloudItems = cloudItems.filter((entry) => entry.id !== item.id);
  marketItems = marketItems.filter((entry) => entry.id !== item.id);
  renderMyCloud();
  renderMarket();
  showToast('Файл удалён из облака');
}

function openAuth(tab = 'login') {
  authModal.classList.remove('hidden');
  setAuthTab(tab);
  document.body.style.overflow = 'hidden';
}

function closeAuth() {
  authModal.classList.add('hidden');
  document.body.style.overflow = '';
  message.textContent = '';
}

function setAuthTab(tab) {
  $$('[data-auth-tab]').forEach((button) => button.classList.toggle('active', button.dataset.authTab === tab));
  $$('.auth-form').forEach((form) => form.classList.remove('active'));
  $(`#${tab}Form`)?.classList.add('active');
  message.textContent = '';
}

function setMessage(text, ok = false) {
  message.textContent = text;
  message.style.color = ok ? '#68dfa0' : '#ffc071';
}

function showToast(text) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3600);
}

function showInfo(kicker, title, text) {
  $('#infoKicker').textContent = kicker;
  $('#infoTitle').textContent = title;
  $('#infoText').textContent = text;
  infoModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeInfo() {
  infoModal.classList.add('hidden');
  document.body.style.overflow = '';
}

function updateSession(user) {
  currentUser = user;
  const signedIn = Boolean(user);
  $$('[data-auth-open]').forEach((node) => node.classList.toggle('hidden', signedIn));
  $('#profileButton').classList.toggle('hidden', !signedIn);
  if (!user) return;
  const username = user.user_metadata?.username || user.email?.split('@')[0] || 'Пользователь';
  $('#profileName').textContent = username;
  $('#dashboardName').textContent = username;
  $('#dashboardEmail').textContent = user.email || '';
  $('#lastLogin').textContent = new Date(user.last_sign_in_at || Date.now()).toLocaleString('ru-RU');
  loadMyCloud();
}

async function initializeAuth() {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  updateSession(data.session?.user || null);
  supabase.auth.onAuthStateChange((_event, session) => updateSession(session?.user || null));
}

$$('[data-auth-open]').forEach((button) => button.addEventListener('click', () => openAuth(button.dataset.authOpen)));
$$('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => setAuthTab(button.dataset.authTab)));
$('#authClose').addEventListener('click', closeAuth);
authModal.addEventListener('click', (event) => { if (event.target === authModal) closeAuth(); });
$('#forgotButton').addEventListener('click', () => setAuthTab('forgot'));
$('.back-login').addEventListener('click', () => setAuthTab('login'));
$$('[data-switch-register]').forEach((button) => button.addEventListener('click', () => setAuthTab('register')));
$$('[data-switch-login]').forEach((button) => button.addEventListener('click', () => setAuthTab('login')));
$$('[data-info-close]').forEach((button) => button.addEventListener('click', closeInfo));
infoModal.addEventListener('click', (event) => { if (event.target === infoModal) closeInfo(); });

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase) return setMessage('Подключите Supabase в config.js — инструкция находится в README.');
  const form = new FormData(event.currentTarget);
  setMessage('Выполняется вход…', true);
  const { error } = await supabase.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') });
  if (error) return setMessage(error.message);
  closeAuth();
  location.hash = '#account';
  showToast('Вход выполнен');
});

$('#registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase) return setMessage('Подключите Supabase в config.js — инструкция находится в README.');
  const form = new FormData(event.currentTarget);
  setMessage('Создаём аккаунт…', true);
  const { error } = await supabase.auth.signUp({
    email: form.get('email'), password: form.get('password'),
    options: { data: { username: form.get('username') }, emailRedirectTo: `${location.origin}${location.pathname}#account` }
  });
  if (error) return setMessage(error.message);
  setMessage('Проверьте почту и подтвердите регистрацию.', true);
});

$('#forgotForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase) return setMessage('Подключите Supabase в config.js — инструкция находится в README.');
  const form = new FormData(event.currentTarget);
  const { error } = await supabase.auth.resetPasswordForEmail(form.get('email'), { redirectTo: `${location.origin}${location.pathname}#account` });
  setMessage(error ? error.message : 'Ссылка отправлена. Проверьте почту.', !error);
});

$('#profileButton').addEventListener('click', () => { location.hash = '#account'; });
$('#signOutButton').addEventListener('click', async () => { if (supabase) await supabase.auth.signOut(); updateSession(null); location.hash = '#home'; showToast('Вы вышли из аккаунта'); });

$$('[data-product]').forEach((button) => button.addEventListener('click', () => {
  const product = button.dataset.product;
  if (!currentUser) return openAuth('register');
  showInfo('SUBSCRIPTION', `Neverlose for ${product}`, 'Страница оплаты подготовлена. Подключите платёжного провайдера в защищённой серверной функции перед приёмом реальных платежей.');
}));

$$('[data-help]').forEach((button) => button.addEventListener('click', () => {
  const articles = {
    start: ['НАЧАЛО РАБОТЫ', 'Создайте аккаунт, подтвердите email и откройте личный кабинет. Загрузки становятся доступны после активации подписки.'],
    security: ['БЕЗОПАСНОСТЬ', 'Используйте уникальный пароль. Восстановление выполняется только через подтверждённый email.'],
    subscription: ['ПОДПИСКА И HWID', 'Срок и устройство отображаются в кабинете. Сброс привязки требует активной подписки.'],
    technical: ['ТЕХНИЧЕСКИЕ ВОПРОСЫ', 'Проверьте обновления, права запуска и целостность файлов. Затем приложите журнал к обращению.']
  };
  showInfo('HELP CENTER', ...articles[button.dataset.help]);
}));

$$('[data-protected-action]').forEach((button) => button.addEventListener('click', () => currentUser ? showInfo('COMMUNITY', 'Новая тема', 'Редактор темы подключается к таблице forum_topics из Supabase.') : openAuth('login')));
$('#resetHwidButton').addEventListener('click', async () => {
  if (!currentUser || !supabase) return showToast('Сначала подключите аккаунт Supabase');
  const { error } = await supabase.from('profiles').update({ hwid: null, hwid_reset_at: new Date().toISOString() }).eq('id', currentUser.id);
  if (error) return showToast(error.message);
  $('#hwidStatus').textContent = 'Сброшен'; showToast('HWID успешно сброшен');
});
$('#resetPasswordButton').addEventListener('click', () => openAuth('forgot'));

window.addEventListener('hashchange', route);
window.addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', scrollY > 30));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeAuth(); closeInfo(); } });
route();
initializeAuth();

$$('[data-market-tab]').forEach((button) => button.addEventListener('click', () => {
  marketKind = button.dataset.marketTab;
  $$('[data-market-tab]').forEach((node) => node.classList.toggle('active', node === button)); renderMarket();
}));
$('#marketSearch').addEventListener('input', renderMarket);
$('#marketRefresh').addEventListener('click', loadMarket);
$('#connectFolderButton').addEventListener('click', connectInstallFolder);
$('#uploadMarketButton').addEventListener('click', () => { if (!currentUser) return openAuth('login'); $('#uploadModal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; });
$('#cloudUploadButton').addEventListener('click', () => { if (!currentUser) return openAuth('login'); $('#uploadModal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; });
$('#uploadClose').addEventListener('click', () => { $('#uploadModal').classList.add('hidden'); document.body.style.overflow = ''; });
$('#uploadModal').addEventListener('click', (event) => { if (event.target.id === 'uploadModal') $('#uploadClose').click(); });
$('#marketUploadForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const status = $('#uploadMessage');
  if (!supabase || !currentUser) { status.textContent = 'Подключите Supabase и войдите в аккаунт.'; return; }
  const form = new FormData(event.currentTarget); const file = form.get('file');
  if (file.size > 5 * 1024 * 1024) { status.textContent = 'Максимальный размер файла — 5 МБ.'; return; }
  const kind = form.get('kind'); const extension = file.name.split('.').pop().toLowerCase();
  if ((kind === 'lua' && extension !== 'lua') || (kind === 'config' && !['cfg','json','txt'].includes(extension))) { status.textContent = 'Тип файла не соответствует выбранной категории.'; return; }
  status.textContent = 'Загрузка…';
  const path = `${currentUser.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const upload = await supabase.storage.from('market').upload(path, file, { upsert: false });
  if (upload.error) { status.textContent = upload.error.message; return; }
  const saved = await supabase.from('market_items').insert({ user_id: currentUser.id, title: form.get('title'), description: form.get('description'), kind, storage_path: path, file_name: file.name, file_size: file.size, published: form.get('published') === 'on' });
  if (saved.error) { await supabase.storage.from('market').remove([path]); status.textContent = saved.error.message; return; }
  event.currentTarget.reset(); $('#uploadClose').click(); marketKind = kind; await Promise.all([loadMarket(), loadMyCloud()]); showToast('Материал загружен в облако');
});

restoreDirectory();
