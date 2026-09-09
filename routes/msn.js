const express = require('express');
const msn = require('../db/msn');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

function handleMsnError(err, res, fallback) {
  const knownCodes = [
    'NOT_FOUND',
    'FORBIDDEN',
    'ALREADY_ANSWERED',
    'SHARING_DISABLED',
    'NOT_ANSWERED',
    'SELF_THREAD',
    'ALREADY_STARTED',
    'THREAD_LIMIT',
    'TURN_LIMIT',
    'ALREADY_REVEALED',
    'NOT_EXHAUSTED',
    'NO_PASS',
    'DEADLINE_PASSED',
  ];
  if (knownCodes.includes(err.code)) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: fallback });
}

// 주제 목록
router.get('/topics', requireLogin, (req, res) => {
  res.json({ topics: msn.listTopics(req.session.userId) });
});

// 주제에 답변 제출 (1회)
router.post('/topics/:id/answer', requireLogin, (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: '답변 내용을 입력해 주세요.' });
  }
  try {
    const answerId = msn.submitAnswer(Number(req.params.id), req.session.userId, content);
    res.status(201).json({ ok: true, answerId });
  } catch (err) {
    handleMsnError(err, res, '답변 작성에 실패했어요.');
  }
});

// 공유된 답변들 보기 (본인도 답변했고, 공유가 켜져있어야 함)
router.get('/topics/:id/answers', requireLogin, (req, res) => {
  try {
    const result = msn.getSharedAnswers(Number(req.params.id), req.session.userId);
    res.json(result);
  } catch (err) {
    handleMsnError(err, res, '답변을 불러오지 못했어요.');
  }
});

// 특정 답변에 말 걸기 (대화방 시작 + 첫 메시지)
router.post('/topics/:id/threads', requireLogin, (req, res) => {
  const { answerId, message } = req.body;
  if (!answerId || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'answerId와 메시지가 필요해요.' });
  }
  try {
    const result = msn.startThread(Number(req.params.id), req.session.userId, Number(answerId), message);
    res.status(201).json({ ok: true, threadId: result.threadId });
  } catch (err) {
    handleMsnError(err, res, '대화 시작에 실패했어요.');
  }
});

// 내 대화방 목록
router.get('/threads', requireLogin, (req, res) => {
  res.json({ threads: msn.listMyThreads(req.session.userId) });
});

// 대화방 메시지 보기
router.get('/threads/:id', requireLogin, (req, res) => {
  try {
    const result = msn.getThreadMessages(Number(req.params.id), req.session.userId);
    res.json(result);
  } catch (err) {
    handleMsnError(err, res, '대화 내용을 불러오지 못했어요.');
  }
});

// 대화방에 메시지 보내기
router.post('/threads/:id/messages', requireLogin, (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: '메시지를 입력해 주세요.' });
  }
  try {
    msn.sendThreadMessage(Number(req.params.id), req.session.userId, content);
    res.status(201).json({ ok: true });
  } catch (err) {
    handleMsnError(err, res, '메시지 전송에 실패했어요.');
  }
});

// 열람권으로 대화 상대 공개
router.post('/threads/:id/reveal', requireLogin, (req, res) => {
  try {
    const result = msn.revealThread(Number(req.params.id), req.session.userId);
    res.json({ ok: true, counterpartNickname: result.counterpartNickname });
  } catch (err) {
    handleMsnError(err, res, '공개에 실패했어요.');
  }
});

module.exports = router;
