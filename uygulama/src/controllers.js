const bcrypt = require('bcryptjs');
const repository = require('./repositories');
const { client: redisClient } = require('./redis');
const { menuCache } = require('./menu-cache');
const { positiveId, isoDate, moneyAmount, menuInput, ratingInput } = require('./input');

function safeUser(user) {
  return { id: user.id, ad: user.ad, soyad: user.soyad, eposta: user.eposta, rol: user.rol };
}

function currentDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekStart(value) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function groupMenuRows(rows, user) {
  const menus = new Map();
  for (const row of rows) {
    if (!menus.has(row.menuId)) {
      const fiyat = user.rol === 'ogrenci' ? row.ogrenciFiyati : row.personelFiyati;
      const deadline = new Date(`${String(row.rezervasyonSon).replace(' ', 'T')}+03:00`);
      menus.set(row.menuId, {
        id: row.menuId,
        tarih: row.tarih,
        yemekhaneId: row.yemekhaneId,
        yemekhane: row.yemekhane,
        ogunId: row.ogunId,
        ogun: row.ogun,
        rezervasyonSon: row.rezervasyonSon,
        ogrenciFiyati: row.ogrenciFiyati,
        personelFiyati: row.personelFiyati,
        fiyat,
        kapasite: row.kapasite,
        rezerve: row.rezerve,
        bosYer: row.bosYer,
        dolulukYuzde: row.dolulukYuzde,
        oySayisi: row.oySayisi,
        ortalamaPuan: row.ortalamaPuan,
        rezervasyonaAcik: deadline > new Date() && row.bosYer > 0,
        userReservation: row.rezervasyonId ? { id: row.rezervasyonId, durum: row.rezervasyonDurumu } : null,
        toplamKalori: 0,
        yemekler: []
      });
    }
    const menu = menus.get(row.menuId);
    if (!menu.yemekler.some((food) => food.id === row.yemekId)) {
      menu.yemekler.push({
        id: row.yemekId,
        ad: row.yemek,
        kategori: row.kategori,
        kategoriSira: row.kategoriSira,
        kalori: row.kalori,
        vejetaryen: Boolean(row.vejetaryen),
        alerjenler: row.alerjenler || ''
      });
      menu.toplamKalori += Number(row.kalori);
    }
  }
  return [...menus.values()];
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function regenerateSession(session) {
  return new Promise((resolve, reject) => {
    session.regenerate((error) => error ? reject(error) : resolve());
  });
}

const controllers = {
  health: asyncRoute(async (_req, res) => {
    await repository.checkConnections();
    await redisClient.ping();
    res.json({ status: 'ok' });
  }),

  login: asyncRoute(async (req, res) => {
    const eposta = typeof req.body?.eposta === 'string' ? req.body.eposta.trim() : '';
    const sifre = typeof req.body?.sifre === 'string' ? req.body.sifre : '';
    if (!eposta || !sifre || eposta.length > 120 || sifre.length > 100) {
      return res.status(400).json({ error: 'E-posta ve şifre gerekli.' });
    }
    const user = await repository.authenticateByEmail(eposta);
    const valid = user && user.aktif && await bcrypt.compare(sifre, user.sifre_hash);
    if (!valid) return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });

    await regenerateSession(req.session);
    req.session.user = safeUser(user);
    res.json({ kullanici: req.session.user });
  }),

  logout: asyncRoute(async (req, res) => {
    if (!req.session) return res.json({ ok: true });
    req.session.destroy((error) => {
      if (error) return res.status(500).json({ error: 'Oturum kapatılamadı.' });
      res.clearCookie('yemekhane.sid');
      res.json({ ok: true });
    });
  }),

  me: asyncRoute(async (req, res) => {
    res.json({ kullanici: req.session.user });
  }),

  lookups: asyncRoute(async (_req, res) => {
    const [yemekhaneler, ogunler, yemekler] = await Promise.all([
      repository.listCafeterias(), repository.listMeals(), repository.listFoods()
    ]);
    res.json({ yemekhaneler, ogunler, yemekler });
  }),

  todayMenus: asyncRoute(async (req, res) => {
    const date = currentDate();
    const yemekhaneId = req.query.yemekhaneId ? positiveId(req.query.yemekhaneId, 'Yemekhane') : null;
    const ogunId = req.query.ogunId ? positiveId(req.query.ogunId, 'Öğün') : null;
    const result = await menuCache.getOrLoad({
      route: 'menus/today',
      userId: req.session.user.id,
      role: req.session.user.rol,
      params: { date, yemekhaneId, ogunId }
    }, async () => {
      const rows = await repository.getMenus({
        start: date, end: date, cafeteriaId: yemekhaneId, mealId: ogunId, userId: req.session.user.id
      });
      return { tarih: date, menuler: groupMenuRows(rows, req.session.user) };
    });
    res.json(result);
  }),

  weekMenus: asyncRoute(async (req, res) => {
    const start = weekStart(req.query.start ? isoDate(req.query.start, 'Başlangıç tarihi') : currentDate());
    const end = shiftDate(start, 6);
    const yemekhaneId = req.query.yemekhaneId ? positiveId(req.query.yemekhaneId, 'Yemekhane') : null;
    const result = await menuCache.getOrLoad({
      route: 'menus/week',
      userId: req.session.user.id,
      role: req.session.user.rol,
      params: { start, end, yemekhaneId }
    }, async () => {
      const rows = await repository.getMenus({
        start, end, cafeteriaId: yemekhaneId, userId: req.session.user.id
      });
      return { baslangic: start, bitis: end, menuler: groupMenuRows(rows, req.session.user) };
    });
    res.json(result);
  }),

  reservations: asyncRoute(async (req, res) => {
    const result = await repository.listReservations(req.session.user.id);
    const now = new Date();
    res.json({
      rezervasyonlar: result.map((item) => ({
        ...item,
        iptalEdilebilir: item.durum === 'aktif' &&
          new Date(`${String(item.rezervasyonSon).replace(' ', 'T')}+03:00`) > now
      }))
    });
  }),

  createReservation: asyncRoute(async (req, res) => {
    const menuId = positiveId(req.body?.menuId, 'Menü');
    const result = await repository.createReservation(req.session.user.id, menuId);
    await menuCache.invalidate('reservation-created');
    res.status(201).json({
      rezervasyonId: result.rezervasyon_id,
      ucret: result.ucret,
      bakiye: result.bakiye
    });
  }),

  cancelReservation: asyncRoute(async (req, res) => {
    const reservationId = positiveId(req.params.id, 'Rezervasyon');
    const result = await repository.cancelReservation(req.session.user.id, reservationId);
    await menuCache.invalidate('reservation-cancelled');
    res.json({ rezervasyonId: result.rezervasyon_id, iade: result.iade, bakiye: result.bakiye });
  }),

  wallet: asyncRoute(async (req, res) => {
    const [bakiye, hareketler] = await Promise.all([
      repository.getBalance(req.session.user.id),
      repository.listMovements(req.session.user.id)
    ]);
    if (bakiye == null) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    res.json({ bakiye, hareketler });
  }),

  topUp: asyncRoute(async (req, res) => {
    const tutar = moneyAmount(req.body?.tutar, { min: 10, max: 1000 });
    const result = await repository.topUp(req.session.user.id, tutar);
    res.status(201).json({ yuklemeId: result.hareket_id, yuklenen: tutar, bakiye: result.bakiye });
  }),

  eligibleRatings: asyncRoute(async (req, res) => {
    const menuler = await repository.eligibleRatings(req.session.user.id);
    res.json({ menuler });
  }),

  saveRating: asyncRoute(async (req, res) => {
    const rating = ratingInput(req.body);
    if (!await repository.hasUsedMenu(req.session.user.id, rating.menuId)) {
      return res.status(403).json({ error: 'Yalnızca kullandığın bir menüyü değerlendirebilirsin.' });
    }
    await repository.saveRating(req.session.user.id, rating);
    await menuCache.invalidate('rating-saved');
    res.status(201).json({ ok: true });
  }),

  adminMenus: asyncRoute(async (req, res) => {
    const start = weekStart(req.query.start ? isoDate(req.query.start, 'Başlangıç tarihi') : currentDate());
    const end = shiftDate(start, 6);
    const yemekhaneId = req.query.yemekhaneId ? positiveId(req.query.yemekhaneId, 'Yemekhane') : null;
    const result = await menuCache.getOrLoad({
      route: 'admin/menus',
      userId: req.session.user.id,
      role: req.session.user.rol,
      params: { start, end, yemekhaneId }
    }, async () => {
      const rows = await repository.getMenus({ start, end, cafeteriaId: yemekhaneId, userId: null });
      const menuler = groupMenuRows(rows, { rol: 'yonetici' });
      return {
        menuler: menuler.map((menu) => ({
          id: menu.id, tarih: menu.tarih, yemekhane: menu.yemekhane, ogun: menu.ogun,
          kapasite: menu.kapasite, rezerve: menu.rezerve, bosYer: menu.bosYer,
          dolulukYuzde: menu.dolulukYuzde, oySayisi: menu.oySayisi,
          ortalamaPuan: menu.ortalamaPuan, ogrenciFiyati: menu.ogrenciFiyati,
          personelFiyati: menu.personelFiyati
        }))
      };
    });
    res.json(result);
  }),

  adminMenu: asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id, 'Menü');
    const menu = await repository.getMenuForAdmin(id);
    if (!menu) return res.status(404).json({ error: 'Menü bulunamadı.' });
    res.json({ menu });
  }),

  saveAdminMenu: asyncRoute(async (req, res) => {
    const menu = menuInput(req.body);
    const id = await repository.saveMenu(menu);
    await menuCache.invalidate('admin-menu-saved');
    res.status(menu.id ? 200 : 201).json({ id });
  })
};

module.exports = { controllers, asyncRoute, safeUser };
