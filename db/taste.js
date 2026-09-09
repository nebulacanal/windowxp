const db = require('./db');

const ANSWER_MAX_LENGTH = 500;
const QUESTION_TYPES = ['text', 'radio', 'checkbox'];

// ── 질문 (관리자 관리) ─────────────────────────────────────────

function parseQuestionRow(q) {
  return {
    id: q.id,
    questionText: q.question_text,
    questionType: q.question_type || 'text',
    options: q.options ? JSON.parse(q.options) : [],
    orderIndex: q.order_index,
  };
}

function listQuestions() {
  return db
    .prepare('SELECT * FROM taste_questions ORDER BY order_index ASC, id ASC')
    .all()
    .map(parseQuestionRow);
}

function validateQuestionInput({ questionText, questionType, options }) {
  if (typeof questionText !== 'string' || questionText.trim().length === 0) {
    return '질문 내용을 입력해 주세요.';
  }
  if (!QUESTION_TYPES.includes(questionType)) {
    return '질문 종류가 올바르지 않아요.';
  }
  if (questionType !== 'text') {
    if (!Array.isArray(options) || options.filter((o) => typeof o === 'string' && o.trim()).length < 2) {
      return '선택지를 2개 이상 입력해 주세요.';
    }
  }
  return null;
}

function createQuestion({ questionText, questionType, options }) {
  const idx = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM taste_questions').get().m + 1;
  const cleanedOptions =
    questionType !== 'text' ? JSON.stringify(options.map((o) => o.trim()).filter(Boolean)) : null;
  const result = db
    .prepare(
      'INSERT INTO taste_questions (question_text, question_type, options, order_index) VALUES (?, ?, ?, ?)'
    )
    .run(questionText.trim(), questionType, cleanedOptions, idx);
  return result.lastInsertRowid;
}

function deleteQuestion(questionId) {
  db.prepare('DELETE FROM taste_answers WHERE question_id = ?').run(questionId);
  db.prepare('DELETE FROM taste_questions WHERE id = ?').run(questionId);
}

// ── 답변 ─────────────────────────────────────────

function validateAnswerForQuestion(question, answerText) {
  if (question.questionType === 'text') {
    if (answerText.length > ANSWER_MAX_LENGTH) {
      return `답변은 ${ANSWER_MAX_LENGTH}자를 넘을 수 없어요.`;
    }
    return null;
  }
  if (!answerText) return null; // 미응답 허용

  let parsed;
  try {
    parsed = question.questionType === 'checkbox' ? JSON.parse(answerText) : answerText;
  } catch (err) {
    return '답변 형식이 올바르지 않아요.';
  }

  if (question.questionType === 'radio') {
    if (!question.options.includes(parsed)) return '선택지에 없는 값이에요.';
  } else if (question.questionType === 'checkbox') {
    if (!Array.isArray(parsed) || parsed.some((v) => !question.options.includes(v))) {
      return '선택지에 없는 값이 포함돼 있어요.';
    }
  }
  return null;
}

// 여러 문항을 한 번에 저장/갱신 (모두 있으면 update, 없으면 insert)
const saveMyAnswers = db.transaction((userId, answers) => {
  const questions = listQuestions();
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  const upsert = db.prepare(
    `INSERT INTO taste_answers (user_id, question_id, answer_text, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, question_id) DO UPDATE SET answer_text = excluded.answer_text, updated_at = datetime('now')`
  );

  for (const a of answers) {
    const question = questionMap.get(a.questionId);
    if (!question) continue; // 존재하지 않는 질문은 조용히 무시
    const answerText = typeof a.answerText === 'string' ? a.answerText.trim() : '';
    const error = validateAnswerForQuestion(question, answerText);
    if (error) {
      const err = new Error(error);
      err.code = 'INVALID_ANSWER';
      throw err;
    }
    upsert.run(userId, a.questionId, answerText);
  }
});

function getMyAnswers(userId) {
  const questions = listQuestions();
  const answerRows = db.prepare('SELECT question_id, answer_text FROM taste_answers WHERE user_id = ?').all(userId);
  const answerMap = new Map(answerRows.map((r) => [r.question_id, r.answer_text]));
  return questions.map((q) => ({
    questionId: q.id,
    questionText: q.questionText,
    questionType: q.questionType,
    options: q.options,
    answerText: answerMap.get(q.id) || '',
  }));
}

// 특정 회원이 동전으로 나를(targetUserId) 열람할 수 있는지
function hasCoinAccess(viewerUserId, targetUserId) {
  const row = db
    .prepare(
      `SELECT id FROM item_purchases
       WHERE buyer_user_id = ? AND recipient_user_id = ? AND item_type = 'coin'`
    )
    .get(viewerUserId, targetUserId);
  return !!row;
}

// 뷰어 입장에서 targetUserId의 취향표를 조회 (본인이거나, 동전으로 열람권을 산 경우만 내용이 보임)
function getTasteChartForViewer(viewerUserId, targetUserId) {
  const canView = viewerUserId === targetUserId || hasCoinAccess(viewerUserId, targetUserId);
  if (!canView) {
    return { canView: false, answers: [] };
  }
  return { canView: true, answers: getMyAnswers(targetUserId) };
}

// 관리자용: 아무 회원의 답변이나 실명으로 조회 (모더레이션용)
function getAnswersForAdmin(userId) {
  return getMyAnswers(userId);
}

module.exports = {
  ANSWER_MAX_LENGTH,
  QUESTION_TYPES,
  validateQuestionInput,
  listQuestions,
  createQuestion,
  deleteQuestion,
  saveMyAnswers,
  getMyAnswers,
  hasCoinAccess,
  getTasteChartForViewer,
  getAnswersForAdmin,
};
