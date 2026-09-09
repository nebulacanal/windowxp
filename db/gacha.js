const db = require('./db');
const points = require('./points');

function validatePrizeInput({ name, weight, pointReward }) {
  if (typeof name !== 'string' || name.trim().length === 0) return '상품 이름을 입력해 주세요.';
  if (!Number.isInteger(weight) || weight < 1) return '확률 가중치는 1 이상의 정수여야 해요.';
  if (!Number.isInteger(pointReward) || pointReward < 0) return '포인트는 0 이상의 정수여야 해요.';
  return null;
}

function createPrize({ name, weight, pointReward }) {
  const result = db
    .prepare('INSERT INTO gacha_prizes (name, weight, point_reward) VALUES (?, ?, ?)')
    .run(name.trim(), weight, pointReward);
  return result.lastInsertRowid;
}

function listAllPrizesForAdmin() {
  return db.prepare('SELECT * FROM gacha_prizes ORDER BY id DESC').all();
}

function listActivePrizes() {
  return db.prepare('SELECT * FROM gacha_prizes WHERE active = 1 AND weight > 0').all();
}

function setPrizeActive(id, active) {
  db.prepare('UPDATE gacha_prizes SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

function pickWeightedPrize(prizes) {
  const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const prize of prizes) {
    roll -= prize.weight;
    if (roll <= 0) return prize;
  }
  return prizes[prizes.length - 1]; // 부동소수점 오차 대비 안전망
}

// 뽑기 1회 진행: 확률대로 상품을 뽑고, 포인트 상품이면 즉시 지급
const drawGacha = db.transaction((userId) => {
  const prizes = listActivePrizes();
  if (prizes.length === 0) {
    const err = new Error('지금은 뽑을 수 있는 상품이 없어요.');
    err.code = 'NO_PRIZES';
    throw err;
  }

  const prize = pickWeightedPrize(prizes);

  const result = db
    .prepare('INSERT INTO gacha_draws (user_id, prize_id, prize_name, point_reward) VALUES (?, ?, ?, ?)')
    .run(userId, prize.id, prize.name, prize.point_reward);

  if (prize.point_reward > 0) {
    points.earnPoints(userId, prize.point_reward, `뽑기 당첨: ${prize.name}`, {
      refType: 'gacha_draw',
      refId: result.lastInsertRowid,
    });
  }

  return { drawId: result.lastInsertRowid, prizeName: prize.name, pointReward: prize.point_reward };
});

function listMyDraws(userId) {
  return db
    .prepare('SELECT id, prize_name, point_reward, created_at FROM gacha_draws WHERE user_id = ? ORDER BY id DESC')
    .all(userId);
}

function listAllDrawsForAdmin(limit = 100) {
  return db
    .prepare(
      `SELECT d.id, d.prize_name, d.point_reward, d.created_at, u.nickname
       FROM gacha_draws d JOIN users u ON u.id = d.user_id
       ORDER BY d.id DESC LIMIT ?`
    )
    .all(limit);
}

module.exports = {
  validatePrizeInput,
  createPrize,
  listAllPrizesForAdmin,
  listActivePrizes,
  setPrizeActive,
  drawGacha,
  listMyDraws,
  listAllDrawsForAdmin,
};
