const db = require('./db');

const ANON_NUMBER_MIN = 1;
const ANON_NUMBER_MAX = 9999;
const MAX_CONTENT_LENGTH = 200;

// 현재 남아있는 메모들과 겹치지 않는 익명 번호를 하나 뽑습니다.
function pickAnonNumber() {
  const usedRows = db.prepare('SELECT anon_number FROM memo_notes').all();
  const used = new Set(usedRows.map((r) => r.anon_number));
  const totalRange = ANON_NUMBER_MAX - ANON_NUMBER_MIN + 1;

  if (used.size >= totalRange) {
    const err = new Error('익명 번호를 더 이상 만들 수 없어요. (전부 사용 중)');
    err.code = 'NUMBER_EXHAUSTED';
    throw err;
  }

  // 무작위 시도로 먼저 찾아보고 (대부분 금방 찾음), 안 되면 남은 번호 중에서 확실히 고름
  for (let i = 0; i < 50; i += 1) {
    const candidate = ANON_NUMBER_MIN + Math.floor(Math.random() * totalRange);
    if (!used.has(candidate)) return candidate;
  }
  for (let n = ANON_NUMBER_MIN; n <= ANON_NUMBER_MAX; n += 1) {
    if (!used.has(n)) return n;
  }
  const err = new Error('익명 번호를 더 이상 만들 수 없어요. (전부 사용 중)');
  err.code = 'NUMBER_EXHAUSTED';
  throw err;
}

const addNote = db.transaction((userId, content) => {
  const anonNumber = pickAnonNumber();
  const result = db
    .prepare('INSERT INTO memo_notes (user_id, anon_number, content) VALUES (?, ?, ?)')
    .run(userId, anonNumber, content);
  return { id: result.lastInsertRowid, anonNumber };
});

function listNotes(limit = 100) {
  return db
    .prepare(
      `SELECT id, anon_number, content, created_at FROM memo_notes
       ORDER BY id DESC LIMIT ?`
    )
    .all(limit);
}

// 관리자용: 실제 작성자 닉네임까지 같이 보여줌
function listNotesForAdmin(limit = 200) {
  return db
    .prepare(
      `SELECT mn.id, mn.anon_number, mn.content, mn.created_at, u.nickname
       FROM memo_notes mn JOIN users u ON u.id = mn.user_id
       ORDER BY mn.id DESC LIMIT ?`
    )
    .all(limit);
}

module.exports = {
  MAX_CONTENT_LENGTH,
  addNote,
  listNotes,
  listNotesForAdmin,
};
