const express = require('express');
const db = require('../db/db');
const { getBadgeLabel } = require('../db/badge');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

// 내 정보 조회
router.get('/me', requireLogin, (req, res) => {
  const user = db
    .prepare(
      `SELECT nickname, preference, curriculum_gay, curriculum_lesbian, profile_note, profile_image_url, points, created_at
       FROM users WHERE id = ?`
    )
    .get(req.session.userId);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없어요.' });

  res.json({
    profile: {
      nickname: user.nickname,
      preference: user.preference,
      curriculumGay: !!user.curriculum_gay,
      curriculumLesbian: !!user.curriculum_lesbian,
      badge: getBadgeLabel(user.preference, user.curriculum_gay, user.curriculum_lesbian),
      profile_note: user.profile_note,
      profileImageUrl: user.profile_image_url || '',
      points: user.points,
      created_at: user.created_at,
    },
  });
});

// 내 문서(자기소개) 및/또는 프로필 사진 수정
router.put('/me', requireLogin, (req, res) => {
  const { profileNote, profileImageUrl } = req.body;

  if (profileNote !== undefined) {
    if (typeof profileNote !== 'string') {
      return res.status(400).json({ error: 'profileNote 값이 올바르지 않아요.' });
    }
    if (profileNote.length > 500) {
      return res.status(400).json({ error: '자기소개는 500자를 넘을 수 없어요.' });
    }
    db.prepare('UPDATE users SET profile_note = ? WHERE id = ?').run(profileNote, req.session.userId);
  }

  if (profileImageUrl !== undefined) {
    if (typeof profileImageUrl !== 'string' || profileImageUrl.length > 2000000) {
      return res.status(400).json({ error: '이미지 용량이 너무 크거나 형식이 올바르지 않아요.' });
    }
    db.prepare('UPDATE users SET profile_image_url = ? WHERE id = ?').run(profileImageUrl, req.session.userId);
  }

  res.json({ ok: true });
});

module.exports = router;
