const db = require('./db');
const notifications = require('./notifications');

/**
 * 포인트 시스템은 "원장(ledger)" 방식으로 관리합니다.
 * - users.points 는 항상 최신 잔액을 담고 있는 캐시값입니다 (빠른 조회용).
 * - point_transactions 테이블에 모든 변동 내역이 남아서, 나중에 "5분 안에 댓글
 *   삭제 시 포인트 회수" 같은 로직이나 관리자 페이지의 내역 조회에 사용됩니다.
 * - 잔액과 원장은 하나의 DB 트랜잭션 안에서 함께 갱신되어 서로 어긋나지 않습니다.
 */

function getBalance(userId) {
  const row = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  if (!row) throw new Error('사용자를 찾을 수 없어요.');
  return row.points;
}

// 포인트를 더하거나(양수) 뺍니다(음수). 잔액이 음수가 되면 에러를 던집니다.
const applyPointChange = db.transaction((userId, amount, reason, opts = {}) => {
  const { refType = null, refId = null, createdBy = null } = opts;

  const user = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('사용자를 찾을 수 없어요.');

  const newBalance = user.points + amount;
  if (newBalance < 0) {
    const err = new Error('포인트가 부족해요.');
    err.code = 'INSUFFICIENT_POINTS';
    throw err;
  }

  db.prepare('UPDATE users SET points = ? WHERE id = ?').run(newBalance, userId);

  const result = db
    .prepare(
      `INSERT INTO point_transactions (user_id, amount, balance_after, reason, ref_type, ref_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, amount, newBalance, reason, refType, refId, createdBy);

  notifications.notify(userId, 'points', { amount, reason, balance: newBalance });

  return { transactionId: result.lastInsertRowid, balance: newBalance };
});

// 포인트 적립 (예: 피드 댓글 작성 보상, 관리자 지급)
function earnPoints(userId, amount, reason, opts = {}) {
  if (amount <= 0) throw new Error('적립 포인트는 0보다 커야 해요.');
  return applyPointChange(userId, amount, reason, opts);
}

// 포인트 차감 (예: 상점 구매, 관리자 회수)
function spendPoints(userId, amount, reason, opts = {}) {
  if (amount <= 0) throw new Error('차감 포인트는 0보다 커야 해요.');
  return applyPointChange(userId, -amount, reason, opts);
}

// 특정 사유(ref_type + ref_id)로 지급됐던 포인트를 정확히 그만큼 되돌립니다.
// 예: 피드 댓글로 5포인트를 받았는데, 5분 안에 그 댓글을 지우면 이 함수로 5포인트를 회수합니다.
function reclaimByRef(refType, refId, reason) {
  const original = db
    .prepare(
      `SELECT * FROM point_transactions
       WHERE ref_type = ? AND ref_id = ? AND amount > 0
       ORDER BY id ASC LIMIT 1`
    )
    .get(refType, refId);

  if (!original) return null; // 애초에 지급된 적이 없으면 아무 것도 안 함

  // 이미 회수됐는지 확인 (중복 회수 방지)
  const alreadyReclaimed = db
    .prepare(
      `SELECT id FROM point_transactions
       WHERE ref_type = ? AND ref_id = ? AND amount < 0`
    )
    .get(refType, refId);
  if (alreadyReclaimed) return null;

  return applyPointChange(original.user_id, -original.amount, reason, {
    refType,
    refId,
  });
}

function getHistory(userId, limit = 50) {
  return db
    .prepare(
      `SELECT id, amount, balance_after, reason, ref_type, ref_id, created_at
       FROM point_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(userId, limit);
}

// 관리자용: 필터링 가능한 전체 거래 내역 조회
function listTransactionsForAdmin({ nickname, refType, limit = 100, offset = 0 } = {}) {
  const clauses = [];
  const params = [];

  if (nickname) {
    clauses.push('u.nickname LIKE ?');
    params.push(`%${nickname}%`);
  }
  if (refType) {
    clauses.push('pt.ref_type = ?');
    params.push(refType);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit, offset);

  return db
    .prepare(
      `SELECT pt.id, pt.amount, pt.balance_after, pt.reason, pt.ref_type, pt.ref_id, pt.created_at,
              u.nickname
       FROM point_transactions pt
       JOIN users u ON u.id = pt.user_id
       ${where}
       ORDER BY pt.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params);
}

module.exports = {
  getBalance,
  earnPoints,
  spendPoints,
  reclaimByRef,
  getHistory,
  listTransactionsForAdmin,
};
