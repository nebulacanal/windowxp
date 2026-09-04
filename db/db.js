const Database = require('better-sqlite3');
const path = require('path');

// DB 파일은 프로젝트 루트의 data.sqlite 하나로 관리합니다.
// 나중에 백업이 필요하면 이 파일 하나만 복사하면 됩니다.
const db = new Database(path.join(__dirname, '..', 'data.sqlite'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    preference TEXT NOT NULL DEFAULT 'top', -- 'top' | 'bottom'
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at TEXT
  );
`);

// 기존 DB에 preference 컬럼이 없을 수도 있으니 안전하게 추가 (이미 있으면 무시)
try {
  db.exec("ALTER TABLE users ADD COLUMN preference TEXT NOT NULL DEFAULT 'top'");
} catch (err) {
  // 컬럼이 이미 있으면 에러가 나는데, 정상적인 상황이라 무시합니다.
}

// 서버 시작 시, 승인된 관리자가 한 명도 없으면 환경변수로 초기 관리자를 만들어 둡니다.
// Render 등에 배포할 때 ADMIN_NICKNAME / ADMIN_PASSWORD 환경변수를 설정해 주세요.
function ensureInitialAdmin() {
  const existingAdmin = db.prepare('SELECT id FROM users WHERE is_admin = 1').get();
  if (existingAdmin) return;

  const nickname = process.env.ADMIN_NICKNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!nickname || !password) {
    console.warn(
      '[7979] 관리자 계정이 없어요. ADMIN_NICKNAME / ADMIN_PASSWORD 환경변수를 설정하면 서버 시작 시 자동으로 관리자 계정이 만들어져요.'
    );
    return;
  }

  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync(password, 10);
  const existing = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname);
  if (existing) {
    db.prepare("UPDATE users SET is_admin = 1, status = 'approved' WHERE id = ?").run(existing.id);
  } else {
    db.prepare(
      "INSERT INTO users (nickname, password_hash, status, is_admin, approved_at) VALUES (?, ?, 'approved', 1, datetime('now'))"
    ).run(nickname, passwordHash);
  }
  console.log(`[7979] 관리자 계정 "${nickname}" 준비 완료.`);
}

ensureInitialAdmin();

module.exports = db;
