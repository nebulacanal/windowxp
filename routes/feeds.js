const express = require('express');
const feeds = require('../db/feeds');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

// 발행된 피드 목록 (댓글 미리보기 최대 2개 포함)
router.get('/', requireLogin, (req, res) => {
  try {
    const list = feeds.listPublishedFeeds(req.session.userId);
    res.json({ feeds: list });
  } catch (err) {
    res.status(500).json({ error: '피드를 불러오지 못했어요.' });
  }
});

// 특정 피드의 전체 댓글 (펼쳐보기)
router.get('/:id/comments', requireLogin, (req, res) => {
  try {
    const { comments, totalCount } = feeds.getCommentsForFeed(Number(req.params.id), req.session.userId);
    res.json({ comments, totalCount });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    res.status(500).json({ error: '댓글을 불러오지 못했어요.' });
  }
});

// 댓글 작성
router.post('/:id/comments', requireLogin, (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: '댓글 내용을 입력해 주세요.' });
  }
  if (content.trim().length > 300) {
    return res.status(400).json({ error: '댓글은 300자를 넘을 수 없어요.' });
  }

  try {
    const result = feeds.addComment(Number(req.params.id), req.session.userId, content);
    res.status(201).json({ ok: true, commentId: result.commentId });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    res.status(500).json({ error: '댓글 작성에 실패했어요.' });
  }
});

// 댓글 삭제 (본인 댓글, 5분 이내면 포인트도 회수)
router.delete('/comments/:commentId', requireLogin, (req, res) => {
  try {
    const result = feeds.deleteComment(Number(req.params.commentId), req.session.userId);
    res.json({ ok: true, reclaimed: result.reclaimed });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message });
    res.status(500).json({ error: '댓글 삭제에 실패했어요.' });
  }
});

// 비밀 댓글 열람 (포인트 차감)
router.post('/comments/:commentId/unlock', requireLogin, (req, res) => {
  try {
    const result = feeds.unlockComment(Number(req.params.commentId), req.session.userId);
    res.json({ ok: true, content: result.content });
  } catch (err) {
    if (err.code === 'NOT_FOUND' || err.code === 'NOT_SECRET') {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === 'INSUFFICIENT_POINTS') {
      return res.status(400).json({ error: '포인트가 부족해요.' });
    }
    res.status(500).json({ error: '열람에 실패했어요.' });
  }
});

module.exports = router;
