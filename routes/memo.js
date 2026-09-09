const express = require('express');
const memo = require('../db/memo');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

// 메모 목록 (최신순, 익명 번호+내용만 - 작성자는 노출 안 됨)
router.get('/', requireLogin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
  const notes = memo.listNotes(limit).map((n) => ({
    id: n.id,
    anonName: `익명${n.anon_number}`,
    content: n.content,
    createdAt: n.created_at,
  }));
  res.json({ notes });
});

// 새 메모 작성
router.post('/', requireLogin, (req, res) => {
  const { content } = req.body;

  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: '내용을 입력해 주세요.' });
  }
  const trimmed = content.trim().replace(/\s*\n\s*/g, ' '); // 한 줄로 정리
  if (trimmed.length > memo.MAX_CONTENT_LENGTH) {
    return res.status(400).json({ error: `${memo.MAX_CONTENT_LENGTH}자를 넘을 수 없어요.` });
  }

  try {
    const result = memo.addNote(req.session.userId, trimmed);
    res.status(201).json({ ok: true, id: result.id, anonName: `익명${result.anonNumber}` });
  } catch (err) {
    if (err.code === 'NUMBER_EXHAUSTED') {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: '메모 작성에 실패했어요.' });
  }
});

module.exports = router;
