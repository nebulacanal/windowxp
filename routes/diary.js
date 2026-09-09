const express = require('express');
const diary = require('../db/diary');
const menuSettings = require('../db/menuSettings');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

function handleDiaryError(err, res, fallback) {
  const known = [
    'ALREADY_PAIRED',
    'NOT_PAIRED',
    'NOT_FOUND',
    'FORBIDDEN',
    'ALREADY_REVEALED',
    'NO_NAMEPLATE',
    'SAME_USER',
    'CHAPTER_LOCKED',
    'FINISHED',
    'GUESSING_CLOSED',
    'ALREADY_GUESSED',
    'FINAL_LOCKED',
  ];
  if (known.includes(err.code)) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: fallback });
}

// 내 상태 조회 (신청 전 / 신청함 / 짝 정해짐 + 추측 상태)
router.get('/me', requireLogin, (req, res) => {
  res.json(diary.getMyStatus(req.session.userId));
});

// 참여 신청
router.post('/apply', requireLogin, (req, res) => {
  if (!menuSettings.isMenuEnabled('diary')) {
    return res.status(400).json({ error: '지금은 참여 신청을 받지 않아요.' });
  }
  try {
    diary.apply(req.session.userId);
    res.status(201).json({ ok: true });
  } catch (err) {
    handleDiaryError(err, res, '신청에 실패했어요.');
  }
});

// 참여 신청 취소
router.delete('/apply', requireLogin, (req, res) => {
  try {
    diary.cancelApplication(req.session.userId);
    res.json({ ok: true });
  } catch (err) {
    handleDiaryError(err, res, '취소에 실패했어요.');
  }
});

// 장 목록 + 내 답변 + 비밀친구 답변
router.get('/chapters', requireLogin, (req, res) => {
  try {
    res.json({ chapters: diary.listChaptersWithEntries(req.session.userId) });
  } catch (err) {
    handleDiaryError(err, res, '불러오지 못했어요.');
  }
});

// 특정 장에 내 답변 쓰기/수정 (현재 장일 때만 가능)
router.put('/chapters/:id/entry', requireLogin, (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: '내용을 입력해 주세요.' });
  }
  if (content.trim().length > diary.ENTRY_MAX_LENGTH) {
    return res.status(400).json({ error: `${diary.ENTRY_MAX_LENGTH}자를 넘을 수 없어요.` });
  }
  try {
    diary.upsertMyChapterEntry(req.session.userId, Number(req.params.id), content);
    res.json({ ok: true });
  } catch (err) {
    handleDiaryError(err, res, '저장에 실패했어요.');
  }
});

// 추측할 수 있는 참가자 명단
router.get('/guess/candidates', requireLogin, (req, res) => {
  res.json({ candidates: diary.listGuessCandidates(req.session.userId) });
});

// 추측 제출 (단 한 번만)
router.post('/guess', requireLogin, (req, res) => {
  const { guessedUserId } = req.body;
  if (!guessedUserId) {
    return res.status(400).json({ error: '추측할 사람을 선택해 주세요.' });
  }
  try {
    diary.submitGuess(req.session.userId, Number(guessedUserId));
    res.json({ ok: true, ...diary.getMyGuessStatus(req.session.userId) });
  } catch (err) {
    handleDiaryError(err, res, '제출에 실패했어요.');
  }
});

// 마지막 장 (자유 대화) 목록
router.get('/final', requireLogin, (req, res) => {
  try {
    res.json({ entries: diary.listFinalEntries(req.session.userId) });
  } catch (err) {
    handleDiaryError(err, res, '불러오지 못했어요.');
  }
});

// 마지막 장에 자유롭게 쓰기
router.post('/final', requireLogin, (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: '내용을 입력해 주세요.' });
  }
  try {
    const entryId = diary.addFinalEntry(req.session.userId, content);
    res.status(201).json({ ok: true, entryId });
  } catch (err) {
    handleDiaryError(err, res, '작성에 실패했어요.');
  }
});

// 이름표 사용해서 비밀친구 닉네임 공개 (추측 실패했을 때의 대비용)
router.post('/reveal', requireLogin, (req, res) => {
  try {
    const result = diary.revealPartner(req.session.userId);
    res.json({ ok: true, partnerNickname: result.partnerNickname });
  } catch (err) {
    handleDiaryError(err, res, '공개에 실패했어요.');
  }
});

module.exports = router;
