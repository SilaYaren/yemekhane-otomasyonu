const test = require('node:test');
const assert = require('node:assert/strict');
const { positiveId, isoDate, moneyAmount, menuInput, ratingInput } = require('../src/input');

test('accepts valid positive IDs and rejects invalid IDs', () => {
  assert.equal(positiveId('12'), 12);
  assert.throws(() => positiveId('0'), { status: 400 });
  assert.throws(() => positiveId('1; DROP TABLE menuler'));
});

test('accepts real calendar dates only', () => {
  assert.equal(isoDate('2026-11-19'), '2026-11-19');
  assert.throws(() => isoDate('2026-02-30'));
  assert.throws(() => isoDate('19.11.2026'));
});

test('enforces the stored balance-loader amount range and decimal precision', () => {
  assert.equal(moneyAmount('10.25', { min: 10, max: 1000 }), 10.25);
  assert.throws(() => moneyAmount(9, { min: 10, max: 1000 }), { status: 400 });
  assert.throws(() => moneyAmount(1001, { min: 10, max: 1000 }));
  assert.throws(() => moneyAmount('10.001', { min: 10, max: 1000 }));
});

test('validates and deduplicates menu foods', () => {
  const parsed = menuInput({
    tarih: '2026-11-20', yemekhaneId: 1, ogunId: 2,
    ogrenciFiyati: 35, personelFiyati: 50, yemekIds: [1, '2', 2]
  });
  assert.deepEqual(parsed.yemekIds, [1, 2]);
  assert.throws(() => menuInput(null), { status: 400 });
  assert.throws(() => menuInput({
    tarih: '2026-11-20', yemekhaneId: 1, ogunId: 2,
    ogrenciFiyati: 35, personelFiyati: 50, yemekIds: []
  }));
});

test('validates ratings and comment length', () => {
  assert.deepEqual(ratingInput({ menuId: 2, puan: 5, yorum: 'Güzeldi' }), {
    menuId: 2, puan: 5, yorum: 'Güzeldi'
  });
  assert.throws(() => ratingInput({ menuId: 2, puan: 6 }));
  assert.throws(() => ratingInput({ menuId: 2, puan: 4, yorum: 'x'.repeat(501) }));
});
