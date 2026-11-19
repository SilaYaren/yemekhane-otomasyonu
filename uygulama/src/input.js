function invalidInput(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidInput('Geçerli bir JSON nesnesi gönderilmelidir.');
  }
}

function positiveId(value, label = 'Kimlik') {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw invalidInput(`${label} geçerli değil.`);
  }
  return parsed;
}

function isoDate(value, label = 'Tarih') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidInput(`${label} geçerli değil.`);
  }
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw invalidInput(`${label} geçerli değil.`);
  }
  return value;
}

function moneyAmount(value, { min = 0, max = 100000 } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < min || amount > max || !/^\d+(\.\d{1,2})?$/.test(String(value))) {
    throw invalidInput(`Tutar ${min} ile ${max} TL arasında ve en fazla iki ondalık basamaklı olmalıdır.`);
  }
  return amount;
}

function menuInput(body) {
  requireObject(body);
  const tarih = isoDate(body.tarih);
  const yemekhaneId = positiveId(body.yemekhaneId, 'Yemekhane');
  const ogunId = positiveId(body.ogunId, 'Öğün');
  const ogrenciFiyati = moneyAmount(body.ogrenciFiyati);
  const personelFiyati = moneyAmount(body.personelFiyati);
  if (!Array.isArray(body.yemekIds) || body.yemekIds.length < 1 || body.yemekIds.length > 30) {
    throw invalidInput('Menüde en az bir, en fazla 30 yemek seçilmelidir.');
  }
  const yemekIds = [...new Set(body.yemekIds.map((id) => positiveId(id, 'Yemek')))];
  return {
    id: body.id == null || body.id === '' ? null : positiveId(body.id, 'Menü'),
    tarih,
    yemekhaneId,
    ogunId,
    ogrenciFiyati,
    personelFiyati,
    yemekIds
  };
}

function ratingInput(body) {
  requireObject(body);
  const menuId = positiveId(body.menuId, 'Menü');
  const puan = Number(body.puan);
  if (!Number.isInteger(puan) || puan < 1 || puan > 5) {
    throw invalidInput('Puan 1 ile 5 arasında tam sayı olmalıdır.');
  }
  if (body.yorum != null && (typeof body.yorum !== 'string' || body.yorum.length > 500)) {
    throw invalidInput('Yorum en fazla 500 karakter olabilir.');
  }
  return { menuId, puan, yorum: body.yorum?.trim() || null };
}

module.exports = { positiveId, isoDate, moneyAmount, menuInput, ratingInput };
