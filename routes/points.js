const express = require('express');
const points = require('../db/points');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

// 내 포인트 잔액
router.get('/me', requireLogin, (req, res) => {
  try {
    const balance = points.getBalance(req.session.userId);
    res.json({ points: balance });
  } catch (err) {
    res.status(500).json({ error: '포인트를 불러오지 못했어요.' });
  }
});

// 내 포인트 변동 내역
router.get('/me/history', requireLogin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const history = points.getHistory(req.session.userId, limit);
  res.json({ history });
});

module.exports = router;
