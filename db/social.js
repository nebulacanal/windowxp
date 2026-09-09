const db = require('./db');
const notifications = require('./notifications');

const DAILY_POKE_LIMIT = 3;

// 오늘(자정 기준) 보낸 찌르기 개수
function countPokesSentToday(userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM pokes
       WHERE from_user_id = ? AND date(created_at) = date('now')`
    )
    .get(userId);
  return row.cnt;
}

function getPokeStatus(userId) {
  const sentToday = countPokesSentToday(userId);
  return { sentToday, remaining: Math.max(0, DAILY_POKE_LIMIT - sentToday), limit: DAILY_POKE_LIMIT };
}

// 찌르기 전송: 하루 최대 3회 (같은 사람에게 여러 번도 가능, 자기 자신은 불가)
const sendPoke = db.transaction((fromUserId, toUserId) => {
  if (fromUserId === toUserId) {
    const err = new Error('자기 자신을 찌를 수는 없어요.');
    err.code = 'SELF_POKE';
    throw err;
  }

  const toUser = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'approved'").get(toUserId);
  if (!toUser) {
    const err = new Error('대상 회원을 찾을 수 없어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const sentToday = countPokesSentToday(fromUserId);
  if (sentToday >= DAILY_POKE_LIMIT) {
    const err = new Error('오늘 사용할 수 있는 찌르기 횟수를 다 썼어요.');
    err.code = 'LIMIT_EXCEEDED';
    throw err;
  }

  const result = db
    .prepare('INSERT INTO pokes (from_user_id, to_user_id) VALUES (?, ?)')
    .run(fromUserId, toUserId);

  // 익명 알림 생성 (누가 찔렀는지는 알림 내용에 담지 않음)
  notifications.notify(toUserId, 'poke', { pokeId: result.lastInsertRowid });

  return { pokeId: result.lastInsertRowid, remaining: DAILY_POKE_LIMIT - sentToday - 1 };
});

function listNotifications(userId, limit = 30) {
  return db
    .prepare(
      `SELECT id, type, payload, is_read, created_at FROM notifications
       WHERE user_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(userId, limit);
}

function countUnreadNotifications(userId) {
  return db.prepare('SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0').get(userId).cnt;
}

function markNotificationsRead(userId, ids) {
  if (!ids || ids.length === 0) {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);
    return;
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(
    `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`
  ).run(userId, ...ids);
}

function deleteNotification(userId, id) {
  db.prepare('DELETE FROM notifications WHERE user_id = ? AND id = ?').run(userId, id);
}

function deleteAllNotifications(userId) {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
}

module.exports = {
  DAILY_POKE_LIMIT,
  getPokeStatus,
  sendPoke,
  listNotifications,
  countUnreadNotifications,
  markNotificationsRead,
  deleteNotification,
  deleteAllNotifications,
};
