const express = require('express');
const db = require('../db/db');

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
    .prepare("SELECT id, nickname, preference, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC")
    .all();
  res.json({ pending: rows });
});

// 승인된(활동 중인) 사용자 목록 — 관리자 화면에서 참고용
router.get('/users', requireAdmin, (req, res) => {
  const rows = db
    .prepare("SELECT id, nickname, preference, status, is_admin, created_at, approved_at FROM users ORDER BY created_at DESC")
    .all();
  res.json({ users: rows });
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

module.exports = router;
