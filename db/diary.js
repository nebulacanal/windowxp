const db = require('./db');
const shop = require('./shop');

const ENTRY_MAX_LENGTH = 2000;

// ── 이벤트 전체 상태 (모집/장/추측/종료) ─────────────────────────────────────────

function getEventState() {
  const row = db.prepare('SELECT guessing_open, finished FROM diary_event_state WHERE id = 1').get();
  return { guessingOpen: !!(row && row.guessing_open), finished: !!(row && row.finished) };
}

function setGuessingOpen(open) {
  db.prepare('UPDATE diary_event_state SET guessing_open = ? WHERE id = 1').run(open ? 1 : 0);
}

function setFinished(finished) {
  db.prepare('UPDATE diary_event_state SET finished = ? WHERE id = 1').run(finished ? 1 : 0);
}

// ── 참여 신청 ─────────────────────────────────────────

function getMyPair(userId) {
  return db
    .prepare('SELECT * FROM exchange_diary_pairs WHERE user_a_id = ? OR user_b_id = ?')
    .get(userId, userId);
}

function apply(userId) {
  if (getMyPair(userId)) {
    const err = new Error('이미 비밀친구가 정해졌어요.');
    err.code = 'ALREADY_PAIRED';
    throw err;
  }
  db.prepare('INSERT OR IGNORE INTO exchange_diary_applications (user_id) VALUES (?)').run(userId);
}

function cancelApplication(userId) {
  if (getMyPair(userId)) {
    const err = new Error('이미 비밀친구가 정해져서 취소할 수 없어요.');
    err.code = 'ALREADY_PAIRED';
    throw err;
  }
  db.prepare('DELETE FROM exchange_diary_applications WHERE user_id = ?').run(userId);
}

// ── 관리자: 신청자 관리 / 매칭 ─────────────────────────────────────────

function listApplicantsForAdmin() {
  return db
    .prepare(
      `SELECT a.user_id, u.nickname, a.created_at
       FROM exchange_diary_applications a JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at ASC`
    )
    .all();
}

function listAllPairsForAdmin() {
  return db
    .prepare(
      `SELECT p.*, ua.nickname AS a_nickname, ub.nickname AS b_nickname,
              (SELECT COUNT(*) FROM diary_chapter_entries e WHERE e.user_id = p.user_a_id) AS a_entry_count,
              (SELECT COUNT(*) FROM diary_chapter_entries e WHERE e.user_id = p.user_b_id) AS b_entry_count,
              (SELECT COUNT(*) FROM diary_final_entries f WHERE f.pair_id = p.id) AS final_count
       FROM exchange_diary_pairs p
       JOIN users ua ON ua.id = p.user_a_id
       JOIN users ub ON ub.id = p.user_b_id
       ORDER BY p.id DESC`
    )
    .all();
}

const createPair = db.transaction((userIdA, userIdB) => {
  if (userIdA === userIdB) {
    const err = new Error('같은 사람을 짝지을 수 없어요.');
    err.code = 'SAME_USER';
    throw err;
  }
  if (getMyPair(userIdA) || getMyPair(userIdB)) {
    const err = new Error('둘 중 한 명은 이미 짝이 있어요.');
    err.code = 'ALREADY_PAIRED';
    throw err;
  }
  const result = db
    .prepare('INSERT INTO exchange_diary_pairs (user_a_id, user_b_id) VALUES (?, ?)')
    .run(userIdA, userIdB);
  db.prepare('DELETE FROM exchange_diary_applications WHERE user_id IN (?, ?)').run(userIdA, userIdB);
  return result.lastInsertRowid;
});

function unpair(pairId) {
  db.prepare('DELETE FROM exchange_diary_pairs WHERE id = ?').run(pairId);
}

// ── 관리자: 장(챕터) 관리 ─────────────────────────────────────────

function createChapter(topicText) {
  const nextNumber = db.prepare('SELECT COALESCE(MAX(chapter_number), 0) AS m FROM diary_chapters').get().m + 1;
  const result = db
    .prepare('INSERT INTO diary_chapters (chapter_number, topic_text) VALUES (?, ?)')
    .run(nextNumber, topicText.trim());
  return result.lastInsertRowid;
}

function listChapters() {
  return db.prepare('SELECT * FROM diary_chapters ORDER BY chapter_number ASC').all();
}

function getCurrentChapter() {
  return db.prepare('SELECT * FROM diary_chapters ORDER BY chapter_number DESC LIMIT 1').get() || null;
}

// ── 장별 일기 ─────────────────────────────────────────

function upsertMyChapterEntry(userId, chapterId, content) {
  const state = getEventState();
  if (state.finished) {
    const err = new Error('교환일기가 종료됐어요.');
    err.code = 'FINISHED';
    throw err;
  }
  if (!getMyPair(userId)) {
    const err = new Error('비밀친구가 정해진 뒤에 쓸 수 있어요.');
    err.code = 'NOT_PAIRED';
    throw err;
  }
  const current = getCurrentChapter();
  if (!current || current.id !== Number(chapterId)) {
    const err = new Error('이미 지난 장은 수정할 수 없어요.');
    err.code = 'CHAPTER_LOCKED';
    throw err;
  }
  db.prepare(
    `INSERT INTO diary_chapter_entries (chapter_id, user_id, content, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(chapter_id, user_id) DO UPDATE SET content = excluded.content, updated_at = datetime('now')`
  ).run(chapterId, userId, content.trim());
}

// 장 목록 + 내 답변 + 비밀친구 답변을 한 번에 묶어서 반환
function listChaptersWithEntries(userId) {
  const pair = getMyPair(userId);
  if (!pair) {
    const err = new Error('아직 비밀친구가 없어요.');
    err.code = 'NOT_PAIRED';
    throw err;
  }
  const partnerId = pair.user_a_id === userId ? pair.user_b_id : pair.user_a_id;
  const chapters = listChapters();
  const current = getCurrentChapter();
  const state = getEventState();

  const myEntries = new Map(
    db.prepare('SELECT chapter_id, content, updated_at FROM diary_chapter_entries WHERE user_id = ?').all(userId).map((r) => [r.chapter_id, r])
  );
  const partnerEntries = new Map(
    db
      .prepare('SELECT chapter_id, content, updated_at FROM diary_chapter_entries WHERE user_id = ?')
      .all(partnerId)
      .map((r) => [r.chapter_id, r])
  );

  return chapters.map((c) => ({
    chapterId: c.id,
    chapterNumber: c.chapter_number,
    topicText: c.topic_text,
    createdAt: c.created_at,
    myEntry: myEntries.get(c.id) ? { content: myEntries.get(c.id).content, updatedAt: myEntries.get(c.id).updated_at } : null,
    partnerEntry: partnerEntries.get(c.id)
      ? { content: partnerEntries.get(c.id).content, updatedAt: partnerEntries.get(c.id).updated_at }
      : null,
    editable: !state.finished && !!current && current.id === c.id,
  }));
}

// ── 추측 게임 ─────────────────────────────────────────

// 추측할 수 있는 후보 명단: 나를 제외한, 현재 짝이 맺어진 모든 참가자
function listGuessCandidates(userId) {
  return db
    .prepare(
      `SELECT DISTINCT u.id, u.nickname
       FROM users u
       WHERE u.id != ?
         AND (u.id IN (SELECT user_a_id FROM exchange_diary_pairs) OR u.id IN (SELECT user_b_id FROM exchange_diary_pairs))
       ORDER BY u.nickname COLLATE NOCASE ASC`
    )
    .all(userId);
}

const submitGuess = db.transaction((userId, guessedUserId) => {
  const state = getEventState();
  if (!state.guessingOpen) {
    const err = new Error('아직 추측 시간이 아니에요.');
    err.code = 'GUESSING_CLOSED';
    throw err;
  }
  if (state.finished) {
    const err = new Error('교환일기가 종료됐어요.');
    err.code = 'FINISHED';
    throw err;
  }
  const pair = getMyPair(userId);
  if (!pair) {
    const err = new Error('아직 비밀친구가 없어요.');
    err.code = 'NOT_PAIRED';
    throw err;
  }
  const role = pair.user_a_id === userId ? 'a' : 'b';
  const already = role === 'a' ? pair.guess_a : pair.guess_b;
  if (already) {
    const err = new Error('이미 추측을 제출했어요.');
    err.code = 'ALREADY_GUESSED';
    throw err;
  }

  const column = role === 'a' ? 'guess_a' : 'guess_b';
  db.prepare(`UPDATE exchange_diary_pairs SET ${column} = ? WHERE id = ?`).run(guessedUserId, pair.id);

  // 내가 정확히 맞혔다면, 결과 계산과 별개로 내 쪽에서는 바로 상대가 공개됨
  const actualPartnerId = role === 'a' ? pair.user_b_id : pair.user_a_id;
  if (guessedUserId === actualPartnerId) {
    const revealColumn = role === 'a' ? 'revealed_to_a' : 'revealed_to_b';
    db.prepare(`UPDATE exchange_diary_pairs SET ${revealColumn} = 1 WHERE id = ?`).run(pair.id);
  }

  // 최신 상태 다시 조회해서, 이제 둘 다 제출했는지 확인
  const refreshed = db.prepare('SELECT * FROM exchange_diary_pairs WHERE id = ?').get(pair.id);
  if (refreshed.guess_a && refreshed.guess_b) {
    const correctA = refreshed.guess_a === refreshed.user_b_id; // a가 b를 정확히 맞췄는지
    const correctB = refreshed.guess_b === refreshed.user_a_id;
    let result;
    if (correctA && correctB) result = 'both_correct';
    else if (correctA || correctB) result = 'one_correct';
    else result = 'both_wrong';

    // 결과와 상관없이 세 경우 모두 마지막 장(자유 대화)이 열림
    db.prepare('UPDATE exchange_diary_pairs SET guess_result = ?, final_unlocked = 1 WHERE id = ?').run(
      result,
      pair.id
    );
  }
});

function getMyGuessStatus(userId) {
  const pair = getMyPair(userId);
  if (!pair) return { paired: false };
  const role = pair.user_a_id === userId ? 'a' : 'b';
  const mySubmitted = !!(role === 'a' ? pair.guess_a : pair.guess_b);
  const partnerSubmitted = !!(role === 'a' ? pair.guess_b : pair.guess_a);
  return {
    paired: true,
    guessSubmitted: mySubmitted,
    partnerGuessSubmitted: partnerSubmitted,
    guessResult: pair.guess_result || null, // null이면 둘 다 아직 제출 안 함(또는 계산 전)
    finalUnlocked: !!pair.final_unlocked,
  };
}

// ── 마지막 장 (자유 대화) ─────────────────────────────────────────

function addFinalEntry(userId, content) {
  const state = getEventState();
  if (state.finished) {
    const err = new Error('교환일기가 종료됐어요.');
    err.code = 'FINISHED';
    throw err;
  }
  const pair = getMyPair(userId);
  if (!pair) {
    const err = new Error('아직 비밀친구가 없어요.');
    err.code = 'NOT_PAIRED';
    throw err;
  }
  if (!pair.final_unlocked) {
    const err = new Error('아직 마지막 장이 열리지 않았어요.');
    err.code = 'FINAL_LOCKED';
    throw err;
  }
  const result = db
    .prepare('INSERT INTO diary_final_entries (pair_id, user_id, content) VALUES (?, ?, ?)')
    .run(pair.id, userId, content.trim());
  return result.lastInsertRowid;
}

function listFinalEntries(userId) {
  const pair = getMyPair(userId);
  if (!pair) {
    const err = new Error('아직 비밀친구가 없어요.');
    err.code = 'NOT_PAIRED';
    throw err;
  }
  return db
    .prepare('SELECT id, user_id, content, created_at FROM diary_final_entries WHERE pair_id = ? ORDER BY id ASC')
    .all(pair.id)
    .map((e) => ({ id: e.id, isMine: e.user_id === userId, content: e.content, createdAt: e.created_at }));
}

// ── 이름표 (추측 실패 시 대비용 fallback) ─────────────────────────────────────────

const revealPartner = db.transaction((userId) => {
  const pair = getMyPair(userId);
  if (!pair) {
    const err = new Error('아직 비밀친구가 없어요.');
    err.code = 'NOT_PAIRED';
    throw err;
  }
  const role = pair.user_a_id === userId ? 'a' : 'b';
  const alreadyRevealed = role === 'a' ? pair.revealed_to_a : pair.revealed_to_b;
  if (alreadyRevealed) {
    const err = new Error('이미 공개했어요.');
    err.code = 'ALREADY_REVEALED';
    throw err;
  }

  const consumed = shop.consumeNameplate(userId);
  if (!consumed) {
    const err = new Error('보유한 이름표가 없어요.');
    err.code = 'NO_NAMEPLATE';
    throw err;
  }

  const column = role === 'a' ? 'revealed_to_a' : 'revealed_to_b';
  db.prepare(`UPDATE exchange_diary_pairs SET ${column} = 1 WHERE id = ?`).run(pair.id);

  const partnerId = role === 'a' ? pair.user_b_id : pair.user_a_id;
  const partner = db.prepare('SELECT nickname FROM users WHERE id = ?').get(partnerId);
  return { partnerNickname: partner.nickname };
});

// 회원 입장에서 지금 내 상태 종합
function getMyStatus(userId) {
  const pair = getMyPair(userId);
  if (!pair) {
    const applied = db.prepare('SELECT id FROM exchange_diary_applications WHERE user_id = ?').get(userId);
    return { status: applied ? 'applied' : 'not_applied' };
  }
  const role = pair.user_a_id === userId ? 'a' : 'b';
  const revealed = role === 'a' ? !!pair.revealed_to_a : !!pair.revealed_to_b;
  let partnerNickname = null;
  if (revealed) {
    const partnerId = role === 'a' ? pair.user_b_id : pair.user_a_id;
    partnerNickname = db.prepare('SELECT nickname FROM users WHERE id = ?').get(partnerId).nickname;
  }
  return {
    status: 'paired',
    pairId: pair.id,
    revealed,
    partnerNickname,
    ...getMyGuessStatus(userId),
    eventState: getEventState(),
  };
}

// ── 관리자: 모더레이션 조회 ─────────────────────────────────────────

function getPairEntriesForAdmin(pairId) {
  const pair = db
    .prepare(
      `SELECT p.*, ua.nickname AS a_nickname, ub.nickname AS b_nickname
       FROM exchange_diary_pairs p
       JOIN users ua ON ua.id = p.user_a_id
       JOIN users ub ON ub.id = p.user_b_id
       WHERE p.id = ?`
    )
    .get(pairId);
  if (!pair) return null;

  const chapters = listChapters();
  const aEntries = new Map(
    db.prepare('SELECT chapter_id, content, updated_at FROM diary_chapter_entries WHERE user_id = ?').all(pair.user_a_id).map((r) => [r.chapter_id, r])
  );
  const bEntries = new Map(
    db.prepare('SELECT chapter_id, content, updated_at FROM diary_chapter_entries WHERE user_id = ?').all(pair.user_b_id).map((r) => [r.chapter_id, r])
  );

  const chapterRows = chapters.map((c) => ({
    chapterNumber: c.chapter_number,
    topicText: c.topic_text,
    aEntry: aEntries.get(c.id) || null,
    bEntry: bEntries.get(c.id) || null,
  }));

  const finalEntries = db
    .prepare(
      `SELECT f.content, f.created_at, u.nickname
       FROM diary_final_entries f JOIN users u ON u.id = f.user_id
       WHERE f.pair_id = ? ORDER BY f.id ASC`
    )
    .all(pairId);

  return {
    aNickname: pair.a_nickname,
    bNickname: pair.b_nickname,
    guessResult: pair.guess_result,
    finalUnlocked: !!pair.final_unlocked,
    chapters: chapterRows,
    finalEntries,
  };
}

module.exports = {
  ENTRY_MAX_LENGTH,
  getEventState,
  setGuessingOpen,
  setFinished,
  apply,
  cancelApplication,
  getMyStatus,
  listApplicantsForAdmin,
  listAllPairsForAdmin,
  createPair,
  unpair,
  createChapter,
  listChapters,
  getCurrentChapter,
  upsertMyChapterEntry,
  listChaptersWithEntries,
  listGuessCandidates,
  submitGuess,
  getMyGuessStatus,
  addFinalEntry,
  listFinalEntries,
  revealPartner,
  getPairEntriesForAdmin,
};
