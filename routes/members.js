const express = require('express');
const db = require('../db/db');
const social = require('../db/social');
const { getBadgeLabel } = require('../db/badge');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

// 승인된 회원 목록 (내 문서 화면에서 사용, '내 컴퓨터'에서 설정한 자기소개 포함)
router.get('/', requireLogin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, nickname, preference, curriculum_gay, curriculum_lesbian, profile_note
       FROM users WHERE status = 'approved' ORDER BY nickname COLLATE NOCASE ASC`
    )
    .all();

  const members = rows.map((row) => ({
    id: row.id,
    nickname: row.nickname,
    preference: row.preference,
    curriculumGay: !!row.curriculum_gay,
    curriculumLesbian: !!row.curriculum_lesbian,
    badge: getBadgeLabel(row.preference, row.curriculum_gay, row.curriculum_lesbian),
    profileNote: row.profile_note,
  }));

  res.json({ members });
});

// 오늘 찌르기 사용 현황 (남은 횟수 등)
router.get('/pokes/status', requireLogin, (req, res) => {
  res.json(social.getPokeStatus(req.session.userId));
});

// 특정 회원 찌르기
router.post('/:id/poke', requireLogin, (req, res) => {
  const toUserId = parseInt(req.params.id, 10);
  try {
    const result = social.sendPoke(req.session.userId, toUserId);
    res.json({ ok: true, remaining: result.remaining });
  } catch (err) {
    if (err.code === 'SELF_POKE') return res.status(400).json({ error: err.message });
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'LIMIT_EXCEEDED') return res.status(429).json({ error: err.message });
    res.status(500).json({ error: '찌르기에 실패했어요.' });
  }
});

module.exports = router;
