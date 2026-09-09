const db = require('./db');

// 토글 가능한 메뉴 키 목록 (내 컴퓨터/내 문서는 핵심 기능이라 토글 대상에서 뺌)
const TOGGLEABLE_MENUS = ['memo', 'shop', 'soribada', 'feed', 'msn', 'taste', 'diary'];

function getAllMenuStatus() {
  const rows = db.prepare('SELECT menu_key, enabled FROM menu_settings').all();
  const map = {};
  TOGGLEABLE_MENUS.forEach((key) => {
    map[key] = true; // 설정이 없으면 기본값 켜짐
  });
  rows.forEach((r) => {
    map[r.menu_key] = !!r.enabled;
  });
  return map;
}

function isMenuEnabled(key) {
  const row = db.prepare('SELECT enabled FROM menu_settings WHERE menu_key = ?').get(key);
  if (!row) return true; // 설정이 없으면 기본값 켜짐
  return !!row.enabled;
}

function setMenuEnabled(key, enabled) {
  if (!TOGGLEABLE_MENUS.includes(key)) {
    const err = new Error('알 수 없는 메뉴예요.');
    err.code = 'INVALID_MENU';
    throw err;
  }
  db.prepare(
    `INSERT INTO menu_settings (menu_key, enabled) VALUES (?, ?)
     ON CONFLICT(menu_key) DO UPDATE SET enabled = excluded.enabled`
  ).run(key, enabled ? 1 : 0);
}

module.exports = {
  TOGGLEABLE_MENUS,
  getAllMenuStatus,
  isMenuEnabled,
  setMenuEnabled,
};
