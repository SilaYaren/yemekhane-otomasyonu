(() => {
  'use strict';

  const state = {
    user: null,
    lookups: null,
    screen: 'gunluk',
    weekStart: mondayOf(today()),
    reservationFilter: 'all',
    rating: 0,
    toastTimer: null
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const screenTitles = {
    gunluk: 'Günün menüsü', haftalik: 'Haftalık menü', rezervasyonlar: 'Rezervasyonlarım',
    bakiye: 'Bakiyem', degerlendirme: 'Değerlendirme', yonetim: 'Yönetim paneli'
  };

  function today() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
  }

  function mondayOf(isoDate) {
    const date = new Date(`${isoDate}T12:00:00Z`);
    const offset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  }

  function shiftDate(isoDate, days) {
    const date = new Date(`${isoDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function formatDate(value, options = { weekday: 'short', day: 'numeric', month: 'short' }) {
    if (!value) return '';
    return new Intl.DateTimeFormat('tr-TR', { ...options, timeZone: 'Europe/Istanbul' })
      .format(new Date(`${String(value).slice(0, 10)}T12:00:00+03:00`));
  }

  function money(value) {
    return `${Number(value || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
  }

  async function api(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
    const response = await fetch(`/api${path}`, {
      ...options, headers, credentials: 'same-origin',
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && state.user) showLogin();
      throw new Error(payload.error || 'İstek tamamlanamadı.');
    }
    return payload;
  }

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => element.classList.remove('show'), 3200);
  }

  function notice(message, success = false) {
    const element = $('#global-notice');
    element.textContent = message;
    element.classList.toggle('success', success);
    element.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearNotice() {
    $('#global-notice').hidden = true;
    $('#global-notice').textContent = '';
  }

  function showLogin(message = '') {
    state.user = null;
    $('#app-shell').hidden = true;
    $('#login-screen').hidden = false;
    const element = $('#login-message');
    element.textContent = message;
    element.hidden = !message;
  }

  function showApp(user) {
    state.user = user;
    $('#login-screen').hidden = true;
    $('#app-shell').hidden = false;
    $('#user-name').textContent = `${user.ad} ${user.soyad}`;
    $('#user-role').textContent = { ogrenci: 'Öğrenci', personel: 'Personel', yonetici: 'Yönetici' }[user.rol] || user.rol;
    $('#user-avatar').textContent = (user.ad || 'K').slice(0, 1).toLocaleUpperCase('tr-TR');
    $('#admin-nav').hidden = user.rol !== 'yonetici';
    $('#today-label').textContent = formatDate(today(), { day: 'numeric', month: 'long' });
    clearNotice();
    fillLookups().then(() => goTo('gunluk')).catch(showError);
  }

  async function fillLookups() {
    state.lookups = await api('/lookups');
    const cafeteriaOptions = state.lookups.yemekhaneler
      .map(item => `<option value="${item.id}">${escapeHtml(item.ad)}</option>`).join('');
    ['#day-cafeteria', '#week-cafeteria', '#admin-cafeteria'].forEach(selector => {
      $(selector).innerHTML = cafeteriaOptions;
    });
    const mealOptions = state.lookups.ogunler
      .map(item => `<option value="${item.id}">${escapeHtml(item.ad)}</option>`).join('');
    ['#day-meal', '#admin-meal'].forEach(selector => {
      $(selector).innerHTML = mealOptions;
    });
    $('#admin-food-options').innerHTML = state.lookups.yemekler.map(food =>
      `<label class="food-option"><input type="checkbox" value="${food.id}"><span>${escapeHtml(food.ad)} <small>· ${escapeHtml(food.kategori)}</small></span></label>`
    ).join('');
    $('#admin-date').value = today();
  }

  function goTo(screen) {
    if (screen === 'yonetim' && state.user?.rol !== 'yonetici') {
      notice('Bu ekran yalnızca yönetici hesabına açıktır.');
      return;
    }
    state.screen = screen;
    clearNotice();
    $$('.screen').forEach(section => {
      const active = section.dataset.page === screen;
      section.hidden = !active;
      section.classList.toggle('active', active);
    });
    $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.screen === screen));
    $('#page-title').textContent = screenTitles[screen];
    closeMobileMenu();
    loadScreen(screen).catch(showError);
  }

  async function loadScreen(screen) {
    if (screen === 'gunluk') await loadDayMenu();
    if (screen === 'haftalik') await loadWeekMenu();
    if (screen === 'rezervasyonlar') await loadReservations();
    if (screen === 'bakiye') await loadWallet();
    if (screen === 'degerlendirme') await loadRatings();
    if (screen === 'yonetim') await loadAdmin();
  }

  function showError(error) {
    notice(error.message || 'Beklenmeyen bir hata oluştu.');
  }

  function menuCard(menu, compact = false) {
    const foods = (menu.yemekler || []).map(food => `
      <div class="dish-row"><span class="dish-dot"></span><span class="dish-info">
        <strong class="dish-name">${escapeHtml(food.ad)}</strong>
        <span class="dish-meta">${food.vejetaryen ? '<span class="tag tag-veg">● Vejetaryen</span>' : ''}
        <span>${Number(food.kalori)} kcal</span>${food.alerjenler ? `<span class="tag tag-allergen">Alerjen: ${escapeHtml(food.alerjenler)}</span>` : ''}</span>
      </span></div>`).join('');
    const foodNames = (menu.yemekler || []).map(food => escapeHtml(food.ad)).join(' · ');
    const disabled = menu.userReservation?.durum === 'aktif' || menu.userReservation?.durum === 'kullanildi' || !menu.rezervasyonaAcik;
    const buttonText = menu.userReservation?.durum === 'aktif' ? 'Ayırdın' :
      menu.userReservation?.durum === 'kullanildi' ? 'Kullanıldı' :
      !menu.rezervasyonaAcik ? 'Süre doldu' : 'Yer ayır';
    const action = `<button class="button button-primary button-small" data-reserve="${menu.id}" ${disabled ? 'disabled' : ''}>${buttonText}</button>`;
    if (compact) {
      return `<article class="week-card"><div class="week-date"><span>${formatDate(menu.tarih)}</span><small>${escapeHtml(menu.yemekhane)}</small></div>
        <h3>${escapeHtml(menu.ogun)}</h3><div class="week-foods">${foodNames || 'Menü detayları bulunmuyor.'}</div>
        <div class="week-bottom"><span class="week-price">${money(menu.fiyat)}</span><span class="availability">${Number(menu.bosYer)} boş yer</span>${action}</div></article>`;
    }
    return `<article class="menu-card"><div class="dish-area"><div class="dish-heading"><h3>${escapeHtml(menu.ogun)} · ${escapeHtml(menu.yemekhane)}</h3><span class="dish-count">${(menu.yemekler || []).length} çeşit</span></div><div class="dish-list">${foods || '<p class="muted">Menü detayı yok.</p>'}</div></div>
      <aside class="menu-side"><div><span class="price-label">SANA ÖZEL FİYAT</span><strong class="price">${money(menu.fiyat)}</strong></div>
      <div class="menu-facts"><span class="fact"><span>Toplam enerji</span><strong>${Number(menu.toplamKalori)} kcal</strong></span><span class="fact"><span>Boş yer</span><strong>${Number(menu.bosYer)}</strong></span><span class="fact"><span>Son saat</span><strong>${formatTime(menu.rezervasyonSon)}</strong></span></div>${action}</aside></article>`;
  }

  function formatTime(value) {
    if (!value) return '—';
    const time = String(value).match(/T(\d{2}:\d{2})/) || String(value).match(/(\d{2}:\d{2})/);
    return time ? time[1] : '—';
  }

  async function loadDayMenu() {
    const params = new URLSearchParams({ yemekhaneId: $('#day-cafeteria').value, ogunId: $('#day-meal').value });
    const result = await api(`/menus/today?${params}`);
    $('#day-menu-list').innerHTML = result.menuler.length
      ? result.menuler.map(menu => menuCard(menu)).join('')
      : '<div class="no-menu">Bu yemekhane ve öğün için bugün henüz menü yok.</div>';
  }

  async function loadWeekMenu() {
    const end = shiftDate(state.weekStart, 6);
    $('#week-range').textContent = `${formatDate(state.weekStart, { day: 'numeric', month: 'short' })} — ${formatDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const params = new URLSearchParams({ start: state.weekStart, yemekhaneId: $('#week-cafeteria').value });
    const result = await api(`/menus/week?${params}`);
    $('#week-menu-list').innerHTML = result.menuler.length
      ? result.menuler.map(menu => menuCard(menu, true)).join('')
      : '<div class="no-menu">Bu hafta için menü bulunamadı.</div>';
  }

  async function loadReservations() {
    const result = await api('/reservations');
    const filtered = state.reservationFilter === 'all' ? result.rezervasyonlar :
      result.rezervasyonlar.filter(item => item.durum === state.reservationFilter);
    $('#reservation-list').innerHTML = filtered.length ? filtered.map(item => `
      <article class="reservation-card"><div><h3>${escapeHtml(item.ogun)} · ${escapeHtml(item.yemekhane)}</h3>
        <p>${formatDate(item.tarih, { weekday: 'long', day: 'numeric', month: 'long' })} · ${money(item.ucret)}</p>
        <p>${escapeHtml(item.yemekler || 'Menü detayları bulunmuyor.')}</p></div>
        <div class="reservation-actions"><span class="status-pill status-${item.durum}">${statusLabel(item.durum)}</span>
        ${item.durum === 'aktif' && item.iptalEdilebilir ? `<button class="button button-soft button-small" data-cancel="${item.id}">İptal et</button>` : ''}</div></article>`).join('')
      : '<div class="no-menu">Bu filtrede gösterilecek rezervasyon yok.</div>';
  }

  function statusLabel(status) {
    return { aktif: 'Aktif', kullanildi: 'Kullanıldı', iptal: 'İptal edildi' }[status] || status;
  }

  async function loadWallet() {
    const result = await api('/wallet');
    $('#wallet-balance').textContent = money(result.bakiye);
    $('#movement-list').innerHTML = result.hareketler.length ? result.hareketler.map(item => `
      <div class="movement"><span class="movement-icon">${item.tutar < 0 ? '↗' : '↙'}</span><span><strong>${escapeHtml(item.aciklama || movementLabel(item.tur))}</strong><small>${formatDate(item.olusturma, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span>
      <span class="movement-amount ${item.tutar < 0 ? 'negative' : ''}">${item.tutar > 0 ? '+' : ''}${money(item.tutar)}</span></div>`).join('')
      : '<p class="muted">Henüz hesap hareketin yok.</p>';
  }

  function movementLabel(type) {
    return { yukleme: 'Bakiye yükleme', rezervasyon: 'Menü rezervasyonu', iade: 'Rezervasyon iadesi' }[type] || 'Hesap hareketi';
  }

  async function loadRatings() {
    const result = await api('/ratings/eligible');
    const select = $('#rating-menu');
    select.innerHTML = '<option value="">Menü seç</option>' + result.menuler.map(item =>
      `<option value="${item.menuId}" data-existing="${item.puan || ''}" data-comment="${escapeHtml(item.yorum || '')}">${formatDate(item.tarih, { day: 'numeric', month: 'long' })} · ${escapeHtml(item.ogun)} · ${escapeHtml(item.yemekhane)}${item.puan ? ' (değerlendirildi)' : ''}</option>`
    ).join('');
    $('#rating-value').value = '';
    setRating(0);
    $('#past-ratings').innerHTML = result.menuler.filter(item => item.puan).map(item =>
      `<article class="rating-item"><strong>${escapeHtml(item.ogun)} · ${formatDate(item.tarih)} · ${Number(item.puan)} / 5 ★</strong><p>${escapeHtml(item.yorum || 'Yorum eklenmedi.')}</p></article>`
    ).join('');
  }

  function setRating(value) {
    state.rating = value;
    $('#rating-value').value = value || '';
    $$('#rating-stars button').forEach(button => {
      const selected = Number(button.dataset.rating) <= value;
      button.classList.toggle('selected', selected);
      button.textContent = selected ? '★' : '☆';
      button.setAttribute('aria-checked', Number(button.dataset.rating) === value ? 'true' : 'false');
    });
  }

  async function loadAdmin() {
    const start = mondayOf(today());
    const params = new URLSearchParams({ start, yemekhaneId: $('#week-cafeteria').value });
    const result = await api(`/admin/menus?${params}`);
    const menus = result.menuler;
    $('#admin-existing-menu').innerHTML = '<option value="">Yeni menü oluştur</option>' + menus.map(item =>
      `<option value="${item.id}">${formatDate(item.tarih)} · ${escapeHtml(item.ogun)} · ${escapeHtml(item.yemekhane)}</option>`
    ).join('');
    const totals = menus.reduce((summary, item) => {
      summary.menus += 1;
      summary.reserved += Number(item.rezerve);
      summary.empty += Number(item.bosYer);
      if (item.ortalamaPuan !== null) {
        summary.ratingTotal += Number(item.ortalamaPuan) * Number(item.oySayisi);
        summary.votes += Number(item.oySayisi);
      }
      return summary;
    }, { menus: 0, reserved: 0, empty: 0, ratingTotal: 0, votes: 0 });
    const average = totals.votes ? (totals.ratingTotal / totals.votes).toFixed(2) : '—';
    $('#admin-summary').innerHTML = `<div class="summary-item"><span>Gösterilen menü</span><strong>${totals.menus}</strong></div><div class="summary-item"><span>Toplam rezervasyon</span><strong>${totals.reserved}</strong></div><div class="summary-item"><span>Toplam boş yer</span><strong>${totals.empty}</strong></div><div class="summary-item"><span>Ortalama puan</span><strong>${average}</strong></div>`;
    $('#admin-menu-list').innerHTML = menus.map(item => `
      <article class="admin-menu-row"><span><strong>${formatDate(item.tarih)} · ${escapeHtml(item.ogun)}</strong><small>${escapeHtml(item.yemekhane)} · ${item.rezerve}/${item.kapasite} yer · ${Number(item.oySayisi)} oy</small></span>
      <span><strong>${item.ortalamaPuan === null ? '—' : `${Number(item.ortalamaPuan).toFixed(2)} ★`}</strong><button class="button button-soft button-small" data-edit-menu="${item.id}">Düzenle</button></span></article>`).join('')
      || '<div class="no-menu">Düzenlenecek menü yok.</div>';
  }

  function resetAdminForm() {
    $('#admin-menu-form').reset();
    $('#admin-menu-id').value = '';
    $('#admin-existing-menu').value = '';
    $('#admin-form-title').textContent = 'Menü oluştur';
    $('#admin-date').value = today();
    $$('#admin-food-options input').forEach(input => { input.checked = false; });
  }

  async function editAdminMenu(id) {
    const result = await api(`/admin/menus/${id}`);
    const menu = result.menu;
    $('#admin-menu-id').value = menu.id;
    $('#admin-existing-menu').value = String(menu.id);
    $('#admin-date').value = String(menu.tarih).slice(0, 10);
    $('#admin-cafeteria').value = String(menu.yemekhaneId);
    $('#admin-meal').value = String(menu.ogunId);
    $('#admin-student-price').value = menu.ogrenciFiyati;
    $('#admin-staff-price').value = menu.personelFiyati;
    const selected = new Set(menu.yemekIds.map(Number));
    $$('#admin-food-options input').forEach(input => { input.checked = selected.has(Number(input.value)); });
    $('#admin-form-title').textContent = 'Menüyü düzenle';
    $('#admin-menu-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function reserveMenu(id) {
    try {
      const result = await api('/reservations', { method: 'POST', body: { menuId: Number(id) } });
      toast(`Rezervasyonun hazır. Güncel bakiyen: ${money(result.bakiye)}`);
      if (state.screen === 'haftalik') await loadWeekMenu();
      else await loadDayMenu();
    } catch (error) {
      notice(error.message);
    }
  }

  async function cancelReservation(id) {
    try {
      const result = await api(`/reservations/${id}`, { method: 'DELETE' });
      toast(`Rezervasyon iptal edildi. İade: ${money(result.iade)} · Bakiye: ${money(result.bakiye)}`);
      await loadReservations();
    } catch (error) {
      notice(error.message);
    }
  }

  async function login(event) {
    event.preventDefault();
    const loginForm = event.currentTarget;
    const form = new FormData(loginForm);
    const message = $('#login-message');
    message.hidden = true;
    try {
      const result = await api('/auth/login', { method: 'POST', body: { eposta: form.get('eposta'), sifre: form.get('sifre') } });
      loginForm.reset();
      showApp(result.kullanici);
    } catch (error) {
      message.textContent = error.message;
      message.hidden = false;
    }
  }

  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); }
    finally { showLogin('Oturumun güvenli biçimde kapatıldı.'); }
  }

  function closeMobileMenu() {
    $('#sidebar').classList.remove('open');
    $('#mobile-overlay').classList.remove('visible');
    $('#mobile-overlay').hidden = true;
  }

  function bindEvents() {
    $('#login-form').addEventListener('submit', login);
    $('#logout-button').addEventListener('click', logout);
    $$('.nav-link').forEach(button => button.addEventListener('click', () => goTo(button.dataset.screen)));
    $$('.brand[data-screen]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); goTo('gunluk'); }));
    $('#day-cafeteria').addEventListener('change', loadDayMenu);
    $('#day-meal').addEventListener('change', loadDayMenu);
    $('#week-cafeteria').addEventListener('change', loadWeekMenu);
    $('#week-prev').addEventListener('click', () => { state.weekStart = shiftDate(state.weekStart, -7); loadWeekMenu().catch(showError); });
    $('#week-next').addEventListener('click', () => { state.weekStart = shiftDate(state.weekStart, 7); loadWeekMenu().catch(showError); });
    $$('.tabs button').forEach(tab => tab.addEventListener('click', () => {
      state.reservationFilter = tab.dataset.reservationFilter;
      $$('.tab').forEach(item => item.classList.toggle('active', item === tab));
      loadReservations().catch(showError);
    }));
    $('#reservation-list').addEventListener('click', event => {
      const button = event.target.closest('[data-cancel]');
      if (button) cancelReservation(button.dataset.cancel);
    });
    document.addEventListener('click', event => {
      const reserve = event.target.closest('[data-reserve]');
      if (reserve) reserveMenu(reserve.dataset.reserve);
      const edit = event.target.closest('[data-edit-menu]');
      if (edit) editAdminMenu(edit.dataset.editMenu).catch(showError);
    });
    $('#topup-form').addEventListener('submit', async event => {
      event.preventDefault();
      try {
        const tutar = Number($('#topup-amount').value);
        const result = await api('/wallet/topups', { method: 'POST', body: { tutar } });
        $('#wallet-balance').textContent = money(result.bakiye);
        await loadWallet();
        toast(`${money(result.yuklenen)} hesabına eklendi.`);
      } catch (error) { notice(error.message); }
    });
    $('#rating-stars').addEventListener('click', event => {
      const button = event.target.closest('[data-rating]');
      if (button) setRating(Number(button.dataset.rating));
    });
    $('#rating-menu').addEventListener('change', event => {
      const option = event.target.selectedOptions[0];
      if (!option?.value) { setRating(0); return; }
      setRating(Number(option.dataset.existing || 0));
      $('#rating-comment').value = option.dataset.comment || '';
    });
    $('#rating-form').addEventListener('submit', async event => {
      event.preventDefault();
      try {
        await api('/ratings', { method: 'POST', body: {
          menuId: Number($('#rating-menu').value), puan: state.rating, yorum: $('#rating-comment').value
        } });
        toast('Değerlendirmen kaydedildi. Teşekkürler!');
        await loadRatings();
      } catch (error) { notice(error.message); }
    });
    $('#admin-existing-menu').addEventListener('change', event => {
      if (event.target.value) editAdminMenu(event.target.value).catch(showError);
      else resetAdminForm();
    });
    $('#admin-reset').addEventListener('click', resetAdminForm);
    $('#admin-menu-form').addEventListener('submit', async event => {
      event.preventDefault();
      const yemekIds = $$('#admin-food-options input:checked').map(input => Number(input.value));
      try {
        await api('/admin/menus', { method: 'POST', body: {
          id: $('#admin-menu-id').value ? Number($('#admin-menu-id').value) : null,
          tarih: $('#admin-date').value, yemekhaneId: Number($('#admin-cafeteria').value),
          ogunId: Number($('#admin-meal').value), ogrenciFiyati: Number($('#admin-student-price').value),
          personelFiyati: Number($('#admin-staff-price').value), yemekIds
        } });
        toast('Menü kaydedildi.');
        resetAdminForm();
        await loadAdmin();
      } catch (error) { notice(error.message); }
    });
    $('#menu-toggle').addEventListener('click', () => {
      $('#sidebar').classList.add('open');
      $('#mobile-overlay').hidden = false;
      $('#mobile-overlay').classList.add('visible');
    });
    $('#mobile-overlay').addEventListener('click', closeMobileMenu);
  }

  async function start() {
    bindEvents();
    try {
      const result = await api('/auth/me');
      showApp(result.kullanici);
    } catch {
      showLogin();
    }
  }

  start();
})();
