const express = require('express');
const social = require('../db/social');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

// 최근 알림 목록 (읽음/안읽음 모두, 최신순) + 안 읽은 개수
router.get('/', requireLogin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  const notifications = social.listNotifications(req.session.userId, limit);
  const unreadCount = social.countUnreadNotifications(req.session.userId);
  res.json({ notifications, unreadCount });
});

// 알림 읽음 처리 (ids 생략 시 전체 읽음 처리)
router.post('/read', requireLogin, (req, res) => {
  const { ids } = req.body || {};
  social.markNotificationsRead(req.session.userId, Array.isArray(ids) ? ids : null);
  res.json({ ok: true });
});

// 알림 1개 삭제
router.delete('/:id', requireLogin, (req, res) => {
  social.deleteNotification(req.session.userId, Number(req.params.id));
  res.json({ ok: true });
});

// 알림 전체 삭제
router.delete('/', requireLogin, (req, res) => {
  social.deleteAllNotifications(req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
