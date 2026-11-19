const { writePool, readPool } = require('./database');

async function rows(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

async function authenticateByEmail(eposta) {
  const result = await rows(readPool,
    'SELECT id, ad, soyad, eposta, sifre_hash, rol, aktif FROM kullanicilar WHERE eposta = ? LIMIT 1',
    [eposta.trim()]);
  return result[0] || null;
}

async function listCafeterias() {
  return rows(readPool, 'SELECT id, ad, konum, kapasite FROM yemekhaneler ORDER BY id');
}

async function listMeals() {
  return rows(readPool, 'SELECT id, ad, sira, son_saat FROM ogunler ORDER BY sira');
}

async function listFoods() {
  return rows(readPool, `SELECT y.id, y.ad, y.kalori, y.vejetaryen, k.ad AS kategori, k.sira AS kategoriSira
    FROM yemekler y JOIN yemek_kategorileri k ON k.id = y.kategori_id
    ORDER BY k.sira, y.ad`);
}

async function getMenus({ start, end, cafeteriaId, mealId, userId }) {
  const conditions = ['d.tarih BETWEEN ? AND ?'];
  const params = [userId || 0, start, end];
  if (cafeteriaId) {
    conditions.push('d.yemekhane_id = ?');
    params.push(cafeteriaId);
  }
  if (mealId) {
    conditions.push('d.ogun_id = ?');
    params.push(mealId);
  }
  return rows(readPool, `SELECT
      d.menu_id AS menuId, d.tarih, d.yemekhane_id AS yemekhaneId, d.yemekhane,
      d.ogun_id AS ogunId, d.ogun, d.ogun_sira AS ogunSira,
      d.rezervasyon_son AS rezervasyonSon, d.ogrenci_fiyati AS ogrenciFiyati,
      d.personel_fiyati AS personelFiyati, d.yemek_id AS yemekId,
      d.yemek, d.kategori, d.kategori_sira AS kategoriSira, d.kalori,
      d.vejetaryen, d.alerjenler, d.alerjen_idler AS alerjenIdler,
      f.kapasite, f.rezerve, f.bos_yer AS bosYer, f.doluluk_yuzde AS dolulukYuzde,
      p.oy_sayisi AS oySayisi, p.ortalama_puan AS ortalamaPuan,
      r.id AS rezervasyonId, r.durum AS rezervasyonDurumu
    FROM v_menu_detay d
    JOIN v_menu_doluluk f ON f.menu_id = d.menu_id
    LEFT JOIN v_menu_puan p ON p.menu_id = d.menu_id
    LEFT JOIN rezervasyonlar r ON r.menu_id = d.menu_id AND r.kullanici_id = ?
    WHERE ${conditions.join(' AND ')}
    ORDER BY d.tarih, d.ogun_sira, d.yemekhane, d.kategori_sira, d.yemek`, params);
}

async function listReservations(userId) {
  return rows(readPool, `SELECT r.id, r.durum, r.ucret, r.olusturma,
      m.tarih, yh.ad AS yemekhane, o.ad AS ogun, o.sira AS ogunSira,
      f.rezervasyon_son AS rezervasyonSon,
      GROUP_CONCAT(d.yemek ORDER BY d.kategori_sira, d.yemek SEPARATOR ' · ') AS yemekler
    FROM rezervasyonlar r
    JOIN menuler m ON m.id = r.menu_id
    JOIN yemekhaneler yh ON yh.id = m.yemekhane_id
    JOIN ogunler o ON o.id = m.ogun_id
    JOIN v_menu_doluluk f ON f.menu_id = m.id
    LEFT JOIN v_menu_detay d ON d.menu_id = m.id
    WHERE r.kullanici_id = ?
    GROUP BY r.id, r.durum, r.ucret, r.olusturma, m.tarih, yh.ad, o.ad, o.sira, f.rezervasyon_son
    ORDER BY m.tarih DESC, o.sira`, [userId]);
}

async function getBalance(userId) {
  const result = await rows(readPool, 'SELECT bakiye FROM kullanicilar WHERE id = ?', [userId]);
  return result[0]?.bakiye ?? null;
}

async function listMovements(userId) {
  return rows(readPool, `SELECT id, tur, tutar, aciklama, olusturma
    FROM bakiye_hareketleri WHERE kullanici_id = ?
    ORDER BY olusturma DESC, id DESC LIMIT 50`, [userId]);
}

async function createReservation(userId, menuId) {
  const [sets] = await writePool.query('CALL sp_rezervasyon_yap(?, ?)', [userId, menuId]);
  const reservation = sets[0]?.[0];
  const [balanceRows] = await writePool.execute('SELECT bakiye FROM kullanicilar WHERE id = ?', [userId]);
  if (!reservation || !balanceRows[0]) {
    throw new Error('Rezervasyon sonucu okunamadı.');
  }
  return { ...reservation, bakiye: balanceRows[0].bakiye };
}

async function cancelReservation(userId, reservationId) {
  const [sets] = await writePool.query('CALL sp_rezervasyon_iptal(?, ?)', [userId, reservationId]);
  const result = sets[0]?.[0];
  if (!result) throw new Error('İptal sonucu okunamadı.');
  const [balanceRows] = await writePool.execute('SELECT bakiye FROM kullanicilar WHERE id = ?', [userId]);
  return { ...result, bakiye: balanceRows[0]?.bakiye };
}

async function topUp(userId, amount) {
  const [sets] = await writePool.query('CALL sp_bakiye_yukle(?, ?)', [userId, amount]);
  const result = sets[0]?.[0];
  if (!result) throw new Error('Bakiye yükleme sonucu okunamadı.');
  return result;
}

async function eligibleRatings(userId) {
  return rows(readPool, `SELECT m.id AS menuId, m.tarih, yh.ad AS yemekhane, o.ad AS ogun,
      d.puan, d.yorum
    FROM rezervasyonlar r
    JOIN menuler m ON m.id = r.menu_id
    JOIN yemekhaneler yh ON yh.id = m.yemekhane_id
    JOIN ogunler o ON o.id = m.ogun_id
    LEFT JOIN degerlendirmeler d ON d.menu_id = m.id AND d.kullanici_id = r.kullanici_id
    WHERE r.kullanici_id = ? AND r.durum = 'kullanildi'
    ORDER BY m.tarih DESC, o.sira`, [userId]);
}

async function hasUsedMenu(userId, menuId) {
  const result = await rows(writePool,
    "SELECT 1 AS used FROM rezervasyonlar WHERE kullanici_id = ? AND menu_id = ? AND durum = 'kullanildi'",
    [userId, menuId]);
  return result.length > 0;
}

async function saveRating(userId, { menuId, puan, yorum }) {
  await writePool.execute(`INSERT INTO degerlendirmeler (kullanici_id, menu_id, puan, yorum)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE puan = VALUES(puan), yorum = VALUES(yorum), olusturma = CURRENT_TIMESTAMP`,
  [userId, menuId, puan, yorum]);
}

async function getMenuForAdmin(menuId) {
  const result = await rows(readPool, `SELECT m.id, m.tarih, m.yemekhane_id AS yemekhaneId,
      m.ogun_id AS ogunId, m.ogrenci_fiyati AS ogrenciFiyati,
      m.personel_fiyati AS personelFiyati,
      COALESCE(GROUP_CONCAT(my.yemek_id ORDER BY my.yemek_id), '') AS yemekIds
    FROM menuler m LEFT JOIN menu_yemekleri my ON my.menu_id = m.id
    WHERE m.id = ? GROUP BY m.id`, [menuId]);
  if (!result[0]) return null;
  return { ...result[0], yemekIds: result[0].yemekIds ? result[0].yemekIds.split(',').map(Number) : [] };
}

async function saveMenu(menu) {
  const connection = await writePool.getConnection();
  try {
    await connection.beginTransaction();
    let menuId;
    if (menu.id) {
      const [existing] = await connection.execute('SELECT id FROM menuler WHERE id = ? FOR UPDATE', [menu.id]);
      if (!existing.length) {
        const error = new Error('Düzenlenecek menü bulunamadı.');
        error.status = 404;
        throw error;
      }
      await connection.execute(`UPDATE menuler
        SET yemekhane_id = ?, tarih = ?, ogun_id = ?, ogrenci_fiyati = ?, personel_fiyati = ?
        WHERE id = ?`,
      [menu.yemekhaneId, menu.tarih, menu.ogunId, menu.ogrenciFiyati, menu.personelFiyati, menu.id]);
      menuId = menu.id;
    } else {
      const [insert] = await connection.execute(`INSERT INTO menuler
        (yemekhane_id, tarih, ogun_id, ogrenci_fiyati, personel_fiyati)
        VALUES (?, ?, ?, ?, ?)`,
      [menu.yemekhaneId, menu.tarih, menu.ogunId, menu.ogrenciFiyati, menu.personelFiyati]);
      menuId = insert.insertId;
    }

    await connection.execute('DELETE FROM menu_yemekleri WHERE menu_id = ?', [menuId]);
    for (const foodId of menu.yemekIds) {
      await connection.execute('INSERT INTO menu_yemekleri (menu_id, yemek_id) VALUES (?, ?)', [menuId, foodId]);
    }
    await connection.commit();
    return menuId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function checkConnections() {
  await Promise.all([
    readPool.execute('SELECT 1'),
    writePool.execute('SELECT 1')
  ]);
}

module.exports = {
  authenticateByEmail, listCafeterias, listMeals, listFoods, getMenus,
  listReservations, getBalance, listMovements, createReservation,
  cancelReservation, topUp, eligibleRatings, hasUsedMenu, saveRating,
  getMenuForAdmin, saveMenu, checkConnections
};
