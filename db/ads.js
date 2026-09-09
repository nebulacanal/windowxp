const db = require('./db');

const SLOTS = ['large', 'small1', 'small2'];

function getAllBanners() {
  const rows = db.prepare('SELECT slot, image_url, link_url FROM ad_banners').all();
  const map = {};
  SLOTS.forEach((slot) => {
    map[slot] = { imageUrl: '', linkUrl: '' };
  });
  rows.forEach((r) => {
    map[r.slot] = { imageUrl: r.image_url, linkUrl: r.link_url };
  });
  return map;
}

function setBanner(slot, { imageUrl, linkUrl }) {
  if (!SLOTS.includes(slot)) {
    const err = new Error('알 수 없는 배너 자리예요.');
    err.code = 'INVALID_SLOT';
    throw err;
  }
  db.prepare(
    `INSERT INTO ad_banners (slot, image_url, link_url) VALUES (?, ?, ?)
     ON CONFLICT(slot) DO UPDATE SET image_url = excluded.image_url, link_url = excluded.link_url`
  ).run(slot, imageUrl || '', linkUrl || '');
}

module.exports = { SLOTS, getAllBanners, setBanner };
