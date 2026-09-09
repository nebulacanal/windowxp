const express = require('express');
const db = require('../db/db');
const soribada = require('../db/soribada');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

// 내가 받은 자장가(mp3) 목록
router.get('/', requireLogin, (req, res) => {
  const tracks = soribada.listMyTracks(req.session.userId);
  res.json({ tracks });
});

// mp3 등록해서 누군가에게 보내기 (지금은 무료, 나중에 상점에서 포인트 차감하도록 연결 예정)
router.post('/', requireLogin, (req, res) => {
  const { toNickname, title, youtubeUrl } = req.body;

  if (!toNickname || typeof toNickname !== 'string') {
    return res.status(400).json({ error: '받는 사람 닉네임을 입력해 주세요.' });
  }

  const recipient = db
    .prepare("SELECT id FROM users WHERE nickname = ? AND status = 'approved'")
    .get(toNickname);
  if (!recipient) {
    return res.status(404).json({ error: '받는 사람을 찾을 수 없어요.' });
  }

  try {
    const result = soribada.sendTrack({
      senderUserId: req.session.userId,
      recipientUserId: recipient.id,
      title,
      youtubeUrl,
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    if (err.code === 'INVALID_TITLE' || err.code === 'INVALID_URL') {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: '등록에 실패했어요.' });
  }
});

module.exports = router;
