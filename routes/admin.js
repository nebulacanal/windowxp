const express = require('express');
const db = require('../db/db');
const points = require('../db/points');
const memo = require('../db/memo');
const soribada = require('../db/soribada');
const feeds = require('../db/feeds');
const shop = require('../db/shop');
const gacha = require('../db/gacha');
const msn = require('../db/msn');
const taste = require('../db/taste');
const menuSettings = require('../db/menuSettings');
const diary = require('../db/diary');
const { getBadgeLabel } = require('../db/badge');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.nickname || !req.session.isAdmin) {
    return res.status(403).json({ error: '관리자만 접근할 수 있어요.' });
  }
  next();
}

// 대기 중인 가입 신청 목록
router.get('/pending', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, nickname, preference, curriculum_gay, curriculum_lesbian, created_at
       FROM users WHERE status = 'pending' ORDER BY created_at ASC`
    )
    .all();
  const pending = rows.map((row) => ({
    ...row,
    badge: getBadgeLabel(row.preference, row.curriculum_gay, row.curriculum_lesbian),
  }));
  res.json({ pending });
});

// 승인된(활동 중인) 사용자 목록 — 관리자 화면에서 참고용
router.get('/users', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, nickname, preference, curriculum_gay, curriculum_lesbian, status, is_admin, points, created_at, approved_at
       FROM users ORDER BY created_at DESC`
    )
    .all();
  const users = rows.map((row) => ({
    ...row,
    badge: getBadgeLabel(row.preference, row.curriculum_gay, row.curriculum_lesbian),
  }));
  res.json({ users });
});

// 관리자가 특정 회원의 포인트를 수동으로 지급/차감
router.post('/points/adjust', requireAdmin, (req, res) => {
  const { userId, amount, reason } = req.body;

  if (!userId || typeof amount !== 'number' || amount === 0) {
    return res.status(400).json({ error: 'userId와 0이 아닌 amount가 필요해요.' });
  }
  if (!reason || typeof reason !== 'string') {
    return res.status(400).json({ error: '지급/차감 사유(reason)를 입력해 주세요.' });
  }

  try {
    const opts = { refType: 'admin_adjust', createdBy: req.session.userId };
    const result =
      amount > 0
        ? points.earnPoints(userId, amount, reason, opts)
        : points.spendPoints(userId, Math.abs(amount), reason, opts);
    res.json({ ok: true, balance: result.balance });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_POINTS') {
      return res.status(400).json({ error: '차감하려는 포인트가 현재 잔액보다 많아요.' });
    }
    res.status(500).json({ error: '포인트 조정에 실패했어요.' });
  }
});

// 관리자가 전체 포인트 거래 내역을 조회 (닉네임/유형 필터 지원)
router.get('/points/transactions', requireAdmin, (req, res) => {
  const { nickname, refType, limit, offset } = req.query;
  const rows = points.listTransactionsForAdmin({
    nickname,
    refType,
    limit: limit ? Math.min(parseInt(limit, 10), 500) : 100,
    offset: offset ? parseInt(offset, 10) : 0,
  });
  res.json({ transactions: rows });
});

// 가입 승인
router.post('/approve/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없어요.' });

  db.prepare("UPDATE users SET status = 'approved', approved_at = datetime('now') WHERE id = ?").run(id);
  res.json({ ok: true });
});

// 가입 거절
router.post('/reject/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없어요.' });

  db.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").run(id);
  res.json({ ok: true });
});

// 메모장(익명 한마디) 내역을 실제 작성자 닉네임과 함께 조회 (모더레이션용)
router.get('/memo-notes', requireAdmin, (req, res) => {
  const notes = memo.listNotesForAdmin();
  res.json({ notes });
});

// 소리바다(자장가) 내역을 보낸/받은 사람과 함께 조회 (모더레이션용)
router.get('/soribada-tracks', requireAdmin, (req, res) => {
  const tracks = soribada.listAllTracksForAdmin();
  res.json({ tracks });
});

// 피드 목록 (예약된 것 포함 전체, 관리자용)
router.get('/feeds', requireAdmin, (req, res) => {
  const list = feeds.listAllFeedsForAdmin();
  res.json({ feeds: list });
});

// 피드 작성 (예약 발행 가능)
router.post('/feeds', requireAdmin, (req, res) => {
  const { type, content, pointReward, unlockPrice, publishAt } = req.body;

  const parsedPointReward = Number.isInteger(pointReward) ? pointReward : parseInt(pointReward, 10) || 0;
  const parsedUnlockPrice = Number.isInteger(unlockPrice) ? unlockPrice : parseInt(unlockPrice, 10) || 0;

  const validationError = feeds.validateFeedInput({
    type,
    content,
    pointReward: parsedPointReward,
    unlockPrice: parsedUnlockPrice,
  });
  if (validationError) return res.status(400).json({ error: validationError });

  // publishAt은 'YYYY-MM-DDTHH:MM' (datetime-local) 형태로 올 수 있어서 SQLite 형식으로 변환
  let publishAtSql = null;
  if (publishAt) {
    const d = new Date(publishAt);
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: '예약 시간이 올바르지 않아요.' });
    }
    publishAtSql = d.toISOString().slice(0, 19).replace('T', ' ');
  }

  const feedId = feeds.createFeed({
    authorId: req.session.userId,
    type,
    content,
    pointReward: parsedPointReward,
    unlockPrice: parsedUnlockPrice,
    publishAt: publishAtSql,
  });

  res.status(201).json({ ok: true, feedId });
});

// 상점 아이템 카탈로그 (전체, 비활성 포함)
router.get('/shop/items', requireAdmin, (req, res) => {
  res.json({ items: shop.listAllItemsForAdmin() });
});

// 상점 아이템 등록
router.post('/shop/items', requireAdmin, (req, res) => {
  const { type, name, price, icon, description } = req.body;
  const parsedPrice = Number.isInteger(price) ? price : parseInt(price, 10) || 0;

  const validationError = shop.validateItemInput({ type, name, price: parsedPrice });
  if (validationError) return res.status(400).json({ error: validationError });

  const itemId = shop.createItem({ type, name, price: parsedPrice, icon, description });
  res.status(201).json({ ok: true, itemId });
});

// 상점 아이템 활성/비활성 전환
router.post('/shop/items/:id/toggle', requireAdmin, (req, res) => {
  const { active } = req.body;
  shop.setItemActive(req.params.id, !!active);
  res.json({ ok: true });
});

// 상점 구매 내역 (보낸사람/받는사람/아이템종류로 필터링 가능, 관리자만 익명 해제해서 볼 수 있음)
router.get('/shop/purchases', requireAdmin, (req, res) => {
  const { senderNickname, recipientNickname, itemType, limit, offset } = req.query;
  const purchases = shop.listPurchasesForAdmin({
    senderNickname,
    recipientNickname,
    itemType,
    limit: limit ? Math.min(parseInt(limit, 10), 500) : 100,
    offset: offset ? parseInt(offset, 10) : 0,
  });
  res.json({ purchases });
});

// 뽑기판 관리
router.get('/gacha/prizes', requireAdmin, (req, res) => {
  res.json({ prizes: gacha.listAllPrizesForAdmin() });
});

router.post('/gacha/prizes', requireAdmin, (req, res) => {
  const { name, weight, pointReward } = req.body;
  const parsedWeight = Number.isInteger(weight) ? weight : parseInt(weight, 10) || 0;
  const parsedPointReward = Number.isInteger(pointReward) ? pointReward : parseInt(pointReward, 10) || 0;

  const validationError = gacha.validatePrizeInput({ name, weight: parsedWeight, pointReward: parsedPointReward });
  if (validationError) return res.status(400).json({ error: validationError });

  const prizeId = gacha.createPrize({ name, weight: parsedWeight, pointReward: parsedPointReward });
  res.status(201).json({ ok: true, prizeId });
});

router.post('/gacha/prizes/:id/toggle', requireAdmin, (req, res) => {
  const { active } = req.body;
  gacha.setPrizeActive(req.params.id, !!active);
  res.json({ ok: true });
});

// 뽑기 전체 내역 (모더레이션용)
router.get('/gacha/draws', requireAdmin, (req, res) => {
  res.json({ draws: gacha.listAllDrawsForAdmin() });
});

// msn(블라인드) 주제 목록 (관리자용, 전체)
router.get('/msn/topics', requireAdmin, (req, res) => {
  res.json({ topics: msn.listAllTopicsForAdmin() });
});

// msn 주제 등록
router.post('/msn/topics', requireAdmin, (req, res) => {
  const { content, editDeadline } = req.body;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: '주제 내용을 입력해 주세요.' });
  }
  let deadlineSql = null;
  if (editDeadline) {
    const d = new Date(editDeadline);
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: '수정 마감 시간이 올바르지 않아요.' });
    }
    deadlineSql = d.toISOString().slice(0, 19).replace('T', ' ');
  }
  const topicId = msn.createTopic({ content, editDeadline: deadlineSql });
  res.status(201).json({ ok: true, topicId });
});

// msn 주제 내용 수정 (마감 전까지만)
router.put('/msn/topics/:id', requireAdmin, (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: '주제 내용을 입력해 주세요.' });
  }
  try {
    msn.updateTopicContent(req.params.id, content);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'DEADLINE_PASSED') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: '수정에 실패했어요.' });
  }
});

// msn 답변 공유 토글
router.post('/msn/topics/:id/sharing', requireAdmin, (req, res) => {
  const { enabled } = req.body;
  msn.setSharingEnabled(req.params.id, !!enabled);
  res.json({ ok: true });
});

// msn 특정 주제의 답변/대화 내역을 기명으로 조회 (모더레이션용)
router.get('/msn/topics/:id/answers', requireAdmin, (req, res) => {
  res.json({ answers: msn.listAnswersForAdmin(req.params.id) });
});
router.get('/msn/topics/:id/threads', requireAdmin, (req, res) => {
  res.json({ threads: msn.listThreadsForAdmin(req.params.id) });
});

// 취향표 질문 관리
router.get('/taste/questions', requireAdmin, (req, res) => {
  res.json({ questions: taste.listQuestions() });
});

router.post('/taste/questions', requireAdmin, (req, res) => {
  const { questionText, questionType, options } = req.body;
  const type = questionType || 'text';
  const validationError = taste.validateQuestionInput({ questionText, questionType: type, options });
  if (validationError) return res.status(400).json({ error: validationError });

  const questionId = taste.createQuestion({ questionText, questionType: type, options });
  res.status(201).json({ ok: true, questionId });
});

router.delete('/taste/questions/:id', requireAdmin, (req, res) => {
  taste.deleteQuestion(req.params.id);
  res.json({ ok: true });
});

// 특정 회원의 취향표를 실명으로 조회 (모더레이션용)
router.get('/taste/:nickname', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE nickname = ?').get(req.params.nickname);
  if (!target) return res.status(404).json({ error: '회원을 찾을 수 없어요.' });
  res.json({ answers: taste.getAnswersForAdmin(target.id) });
});

// 메뉴 노출 on/off 관리
router.get('/menus', requireAdmin, (req, res) => {
  res.json({ menus: menuSettings.getAllMenuStatus() });
});

router.post('/menus/:key', requireAdmin, (req, res) => {
  const { enabled } = req.body;
  try {
    menuSettings.setMenuEnabled(req.params.key, !!enabled);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'INVALID_MENU') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: '설정 변경에 실패했어요.' });
  }
});

// 교환일기 신청자 목록
router.get('/diary/applicants', requireAdmin, (req, res) => {
  res.json({ applicants: diary.listApplicantsForAdmin() });
});

// 교환일기 짝 목록
router.get('/diary/pairs', requireAdmin, (req, res) => {
  res.json({ pairs: diary.listAllPairsForAdmin() });
});

// 짝 맺어주기
router.post('/diary/pairs', requireAdmin, (req, res) => {
  const { userIdA, userIdB } = req.body;
  if (!userIdA || !userIdB) {
    return res.status(400).json({ error: '두 회원을 모두 선택해 주세요.' });
  }
  try {
    const pairId = diary.createPair(Number(userIdA), Number(userIdB));
    res.status(201).json({ ok: true, pairId });
  } catch (err) {
    if (err.code === 'SAME_USER' || err.code === 'ALREADY_PAIRED') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: '짝 맺기에 실패했어요.' });
  }
});

// 짝 해제
router.delete('/diary/pairs/:id', requireAdmin, (req, res) => {
  diary.unpair(req.params.id);
  res.json({ ok: true });
});

// 특정 짝의 일기 전체를 실명으로 조회 (모더레이션용)
router.get('/diary/pairs/:id/entries', requireAdmin, (req, res) => {
  const result = diary.getPairEntriesForAdmin(req.params.id);
  if (!result) return res.status(404).json({ error: '짝을 찾을 수 없어요.' });
  res.json(result);
});

// 이벤트 전체 상태 (진행 중인 장, 추측 오픈 여부, 종료 여부)
router.get('/diary/state', requireAdmin, (req, res) => {
  res.json({ ...diary.getEventState(), chapters: diary.listChapters() });
});

// 새 장(주제) 등록 — 등록하는 순간 이전 장은 자동으로 잠김
router.post('/diary/chapters', requireAdmin, (req, res) => {
  const { topicText } = req.body;
  if (typeof topicText !== 'string' || topicText.trim().length === 0) {
    return res.status(400).json({ error: '주제 내용을 입력해 주세요.' });
  }
  const chapterId = diary.createChapter(topicText);
  res.status(201).json({ ok: true, chapterId });
});

// 추측 단계 열기 (마지막 주제 올린 뒤 누르는 버튼)
router.post('/diary/guessing/open', requireAdmin, (req, res) => {
  diary.setGuessingOpen(true);
  res.json({ ok: true });
});

// 완전 종료 (모든 작성/추측 중지, 읽기만 가능)
router.post('/diary/finish', requireAdmin, (req, res) => {
  diary.setFinished(true);
  res.json({ ok: true });
});

module.exports = router;
