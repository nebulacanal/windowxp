const db = require('./db');
const points = require('./points');
const soribada = require('./soribada');
const notifications = require('./notifications');
const gacha = require('./gacha');

// 지금 단계에서 실제로 구매/사용 가능한 종류 (전부 다 나옴)
const ACTIVE_TYPES = ['gift', 'anon_note', 'mp3', 'magnifier', 'pass', 'coin', 'nameplate', 'gacha'];
const ALL_TYPES = ['gift', 'anon_note', 'mp3', 'magnifier', 'pass', 'nameplate', 'coin', 'gacha'];

const NOTE_MAX_LENGTH = 30; // 공백 제외

function validateItemInput({ type, name, price }) {
  if (!ALL_TYPES.includes(type)) return '아이템 종류가 올바르지 않아요.';
  if (typeof name !== 'string' || name.trim().length === 0) return '아이템 이름을 입력해 주세요.';
  if (!Number.isInteger(price) || price < 0) return '가격은 0 이상의 정수여야 해요.';
  return null;
}

function listActiveItems() {
  return db
    .prepare(`SELECT id, type, name, price, icon, description FROM shop_items WHERE active = 1 AND type IN (${ACTIVE_TYPES.map(() => '?').join(',')}) ORDER BY id ASC`)
    .all(...ACTIVE_TYPES);
}

function listAllItemsForAdmin() {
  return db.prepare('SELECT * FROM shop_items ORDER BY id DESC').all();
}

function createItem({ type, name, price, icon, description }) {
  const result = db
    .prepare(
      `INSERT INTO shop_items (type, name, price, icon, description) VALUES (?, ?, ?, ?, ?)`
    )
    .run(type, name.trim(), price, icon || '🎁', description || '');
  return result.lastInsertRowid;
}

function setItemActive(itemId, active) {
  db.prepare('UPDATE shop_items SET active = ? WHERE id = ?').run(active ? 1 : 0, itemId);
}

function resolveRecipient(nickname) {
  return db.prepare("SELECT id, nickname FROM users WHERE nickname = ? AND status = 'approved'").get(nickname);
}

// 구매 + 전송을 하나의 트랜잭션으로 처리 (포인트 차감 + 기록 + 필요 시 소리바다 연동)
const purchaseItem = db.transaction((buyerUserId, { itemId, toNickname, message, mp3Title, mp3YoutubeUrl }) => {
  const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND active = 1').get(itemId);
  if (!item) {
    const err = new Error('구매할 수 없는 아이템이에요.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (!ACTIVE_TYPES.includes(item.type)) {
    const err = new Error('아직 구매할 수 없는 아이템이에요.');
    err.code = 'NOT_AVAILABLE';
    throw err;
  }

  let recipientId = buyerUserId; // 돋보기는 자기 자신용
  let extraData = null;
  let noteMessage = null;

  if (item.type === 'gift' || item.type === 'anon_note' || item.type === 'mp3' || item.type === 'coin') {
    const recipient = resolveRecipient(toNickname);
    if (!recipient) {
      const err = new Error('받는 사람을 찾을 수 없어요.');
      err.code = 'RECIPIENT_NOT_FOUND';
      throw err;
    }
    recipientId = recipient.id;
  }

  if (item.type === 'coin') {
    if (recipientId === buyerUserId) {
      const err = new Error('내 취향표는 이미 볼 수 있어요.');
      err.code = 'SELF_TARGET';
      throw err;
    }
    const already = db
      .prepare(
        `SELECT id FROM item_purchases WHERE buyer_user_id = ? AND recipient_user_id = ? AND item_type = 'coin'`
      )
      .get(buyerUserId, recipientId);
    if (already) {
      const err = new Error('이미 이 회원의 취향표를 볼 수 있어요.');
      err.code = 'ALREADY_UNLOCKED';
      throw err;
    }
  }

  if (item.type === 'anon_note') {
    if (typeof message !== 'string' || message.trim().length === 0) {
      const err = new Error('쪽지 내용을 입력해 주세요.');
      err.code = 'INVALID_MESSAGE';
      throw err;
    }
    const noSpaceLength = message.replace(/\s/g, '').length;
    if (noSpaceLength > NOTE_MAX_LENGTH) {
      const err = new Error(`쪽지는 공백 제외 ${NOTE_MAX_LENGTH}자를 넘을 수 없어요.`);
      err.code = 'INVALID_MESSAGE';
      throw err;
    }
    noteMessage = message.trim();
  }

  // 포인트 차감 먼저 (부족하면 여기서 예외가 나서 전체 롤백됨)
  points.spendPoints(buyerUserId, item.price, `상점 구매: ${item.name}`, {
    refType: 'shop_purchase',
    refId: itemId,
  });

  if (item.type === 'mp3') {
    const track = soribada.sendTrack({
      senderUserId: buyerUserId,
      recipientUserId: recipientId,
      title: mp3Title,
      youtubeUrl: mp3YoutubeUrl,
    });
    extraData = JSON.stringify({ trackId: track.id, fileName: track.fileName });
  }

  let gachaResult = null;
  if (item.type === 'gacha') {
    gachaResult = gacha.drawGacha(buyerUserId);
    extraData = JSON.stringify({ prizeName: gachaResult.prizeName, pointReward: gachaResult.pointReward });
  }

  const result = db
    .prepare(
      `INSERT INTO item_purchases (item_id, item_type, item_name, buyer_user_id, recipient_user_id, message, extra_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(itemId, item.type, item.name, buyerUserId, recipientId, noteMessage, extraData);

  // 자기 자신용 아이템(돋보기 등)이 아니라 실제로 남에게 보낸 경우에만 알림
  if (recipientId !== buyerUserId) {
    if (item.type === 'mp3') {
      notifications.notify(recipientId, 'soribada', { itemName: item.name });
    } else if (item.type === 'coin') {
      // 완전 익명: 누가 봤는지는 절대 알리지 않고, "누군가 열람했다"는 사실만 알림
      notifications.notify(recipientId, 'taste_viewed', {});
    } else {
      notifications.notify(recipientId, 'item_received', { itemType: item.type, itemName: item.name });
    }
  }

  return { purchaseId: result.lastInsertRowid, gachaResult };
});

// 내가 받은 선물/쪽지/mp3 (발신자는 돋보기로 공개 전까지 안 보임)
function listMyReceivedItems(userId) {
  const rows = db
    .prepare(
      `SELECT ip.id, ip.item_type, ip.item_name, ip.message, ip.extra_data, ip.revealed, ip.created_at,
              u.nickname AS sender_nickname
       FROM item_purchases ip JOIN users u ON u.id = ip.buyer_user_id
       WHERE ip.recipient_user_id = ? AND ip.item_type IN ('gift','anon_note','mp3')
       ORDER BY ip.id DESC`
    )
    .all(userId);

  return rows.map((r) => ({
    id: r.id,
    type: r.item_type,
    itemName: r.item_name,
    message: r.message,
    extraData: r.extra_data ? JSON.parse(r.extra_data) : null,
    revealed: !!r.revealed,
    senderNickname: r.revealed ? r.sender_nickname : null,
    createdAt: r.created_at,
  }));
}

// 내가 보유한(아직 안 쓴) 돋보기 개수
function countUnusedMagnifiers(userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM item_purchases
       WHERE buyer_user_id = ? AND item_type = 'magnifier' AND used = 0`
    )
    .get(userId);
  return row.cnt;
}

// 내가 보유한(아직 안 쓴) 열람권 개수 (msn 블라인드 상대 공개용)
function countUnusedPasses(userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM item_purchases
       WHERE buyer_user_id = ? AND item_type = 'pass' AND used = 0`
    )
    .get(userId);
  return row.cnt;
}

// 열람권 1개를 소모합니다. 성공하면 true, 보유한 게 없으면 false.
function consumePass(userId) {
  const pass = db
    .prepare(`SELECT id FROM item_purchases WHERE buyer_user_id = ? AND item_type = 'pass' AND used = 0 LIMIT 1`)
    .get(userId);
  if (!pass) return false;
  db.prepare('UPDATE item_purchases SET used = 1 WHERE id = ?').run(pass.id);
  return true;
}

// 내가 보유한(아직 안 쓴) 이름표 개수 (교환일기 비밀친구 공개용)
function countUnusedNameplates(userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM item_purchases
       WHERE buyer_user_id = ? AND item_type = 'nameplate' AND used = 0`
    )
    .get(userId);
  return row.cnt;
}

// 이름표 1개를 소모합니다. 성공하면 true, 보유한 게 없으면 false.
function consumeNameplate(userId) {
  const row = db
    .prepare(`SELECT id FROM item_purchases WHERE buyer_user_id = ? AND item_type = 'nameplate' AND used = 0 LIMIT 1`)
    .get(userId);
  if (!row) return false;
  db.prepare('UPDATE item_purchases SET used = 1 WHERE id = ?').run(row.id);
  return true;
}

// 돋보기 사용: 내가 가진 미사용 돋보기 1개를 소모해서, 내가 받은 선물/쪽지 중 하나의 발신자를 공개
const useMagnifier = db.transaction((userId, targetPurchaseId) => {
  const magnifier = db
    .prepare(
      `SELECT id FROM item_purchases WHERE buyer_user_id = ? AND item_type = 'magnifier' AND used = 0 LIMIT 1`
    )
    .get(userId);
  if (!magnifier) {
    const err = new Error('사용할 수 있는 돋보기가 없어요.');
    err.code = 'NO_MAGNIFIER';
    throw err;
  }

  const target = db
    .prepare(
      `SELECT * FROM item_purchases WHERE id = ? AND recipient_user_id = ? AND item_type IN ('gift','anon_note')`
    )
    .get(targetPurchaseId, userId);
  if (!target) {
    const err = new Error('공개할 수 있는 아이템이 아니에요.');
    err.code = 'INVALID_TARGET';
    throw err;
  }
  if (target.revealed) {
    const err = new Error('이미 발신자가 공개된 아이템이에요.');
    err.code = 'ALREADY_REVEALED';
    throw err;
  }

  db.prepare('UPDATE item_purchases SET used = 1 WHERE id = ?').run(magnifier.id);
  db.prepare('UPDATE item_purchases SET revealed = 1 WHERE id = ?').run(targetPurchaseId);

  const sender = db
    .prepare(
      `SELECT u.nickname FROM item_purchases ip JOIN users u ON u.id = ip.buyer_user_id WHERE ip.id = ?`
    )
    .get(targetPurchaseId);

  return { senderNickname: sender.nickname };
});

// 관리자용: 필터링 가능한 전체 구매 내역
function listPurchasesForAdmin({ senderNickname, recipientNickname, itemType, limit = 100, offset = 0 } = {}) {
  const clauses = [];
  const params = [];

  if (senderNickname) {
    clauses.push('sender.nickname LIKE ?');
    params.push(`%${senderNickname}%`);
  }
  if (recipientNickname) {
    clauses.push('recipient.nickname LIKE ?');
    params.push(`%${recipientNickname}%`);
  }
  if (itemType) {
    clauses.push('ip.item_type = ?');
    params.push(itemType);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit, offset);

  return db
    .prepare(
      `SELECT ip.id, ip.item_type, ip.item_name, ip.message, ip.extra_data, ip.created_at,
              sender.nickname AS sender_nickname, recipient.nickname AS recipient_nickname
       FROM item_purchases ip
       JOIN users sender ON sender.id = ip.buyer_user_id
       JOIN users recipient ON recipient.id = ip.recipient_user_id
       ${where}
       ORDER BY ip.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params);
}

module.exports = {
  ACTIVE_TYPES,
  ALL_TYPES,
  NOTE_MAX_LENGTH,
  validateItemInput,
  listActiveItems,
  listAllItemsForAdmin,
  createItem,
  setItemActive,
  purchaseItem,
  listMyReceivedItems,
  countUnusedMagnifiers,
  countUnusedPasses,
  consumePass,
  countUnusedNameplates,
  consumeNameplate,
  useMagnifier,
  listPurchasesForAdmin,
};
