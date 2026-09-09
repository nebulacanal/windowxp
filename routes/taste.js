const express = require('express');
const db = require('../db/db');
const taste = require('../db/taste');
const menuSettings = require('../db/menuSettings');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

// 질문 목록
router.get('/questions', requireLogin, (req, res) => {
  res.json({ questions: taste.listQuestions() });
});

// 내 답변 조회
router.get('/me', requireLogin, (req, res) => {
  res.json({ answers: taste.getMyAnswers(req.session.userId) });
});

// 내 답변 저장 (여러 문항 한 번에) — 취향표 메뉴가 켜져 있는 동안에만 가능
router.put('/me', requireLogin, (req, res) => {
  if (!menuSettings.isMenuEnabled('taste')) {
    return res.status(400).json({ error: '지금은 취향표를 수정할 수 없어요.' });
  }

  const { answers } = req.body;
  if (!Array.isArray(answers)) {
    return res.status(400).json({ error: 'answers 배열이 필요해요.' });
  }
  try {
    taste.saveMyAnswers(req.session.userId, answers);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'INVALID_ANSWER') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: '저장에 실패했어요.' });
  }
});

// 다른 회원의 취향표 열람 (본인이거나 동전 구매한 경우만 실제 내용이 보임)
router.get('/:nickname', requireLogin, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE nickname = ?').get(req.params.nickname);
  if (!target) return res.status(404).json({ error: '회원을 찾을 수 없어요.' });

  const result = taste.getTasteChartForViewer(req.session.userId, target.id);
  res.json(result);
});

module.exports = router;
