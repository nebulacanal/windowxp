const db = require('./db');
const shop = require('./shop');
const notifications = require('./notifications');

const MAX_THREADS_PER_TOPIC = 3; // 한 회원이 먼저 말을 걸 수 있는 상대 수
const OWNER_MAX_TURNS = 2; // 원 답변을 쓴 사람이 보낼 수 있는 메시지 수
const INITIATOR_MAX_TURNS = 3; // 먼저 말을 건 사람이 보낼 수 있는 메시지 수

// ── 주제(관리자) ─────────────────────────────────────────

function createTopic({ content, editDeadline }) {
  const result = db
    .prepare('INSERT INTO msn_topics (content, edit_deadline) VALUES (?, ?)')
    .run(content.trim(), editDeadline || null);
  const topicId = result.lastInsertRowid;

  // 승인된 전체 회원에게 새 주제 알림
  const approvedUserIds = db
    .prepare("SELECT id FROM users WHERE status = 'approved'")
    .all()
    .map((u) => u.id);
  notifications.notifyMany(approvedUserIds, 'msn_topic', { topicId, preview: content.trim().slice(0, 40) });

  return topicId;
}

function updateTopicContent(topicId, content) {
  const topic = db.prepare('SELECT * FROM msn_topics WHERE id = ?').get(topicId);
  if (!topic) {
    const err = new Error('주제를 찾을 수 없어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (topic.edit_deadline) {
    const row = db
      .prepare(`SELECT (strftime('%s', ?) - strftime('%s','now')) AS remaining`)
      .get(topic.edit_deadline);
    if (row.remaining <= 0) {
      const err = new Error('수정 가능 시간이 지났어요.');
      err.code = 'DEADLINE_PASSED';
      throw err;
    }
  }
  db.prepare('UPDATE msn_topics SET content = ? WHERE id = ?').run(content.trim(), topicId);
}

function setSharingEnabled(topicId, enabled) {
  db.prepare('UPDATE msn_topics SET sharing_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, topicId);
}

function listTopics(viewerUserId) {
  const topics = db.prepare('SELECT * FROM msn_topics ORDER BY id DESC').all();
  return topics.map((t) => {
    const myAnswer = db
      .prepare('SELECT id FROM msn_answers WHERE topic_id = ? AND user_id = ?')
      .get(t.id, viewerUserId);
    const answerCount = db
      .prepare('SELECT COUNT(*) AS cnt FROM msn_answers WHERE topic_id = ?')
      .get(t.id).cnt;
    const myThreadCount = db
      .prepare('SELECT COUNT(*) AS cnt FROM msn_threads WHERE topic_id = ? AND initiator_user_id = ?')
      .get(t.id, viewerUserId).cnt;

    return {
      id: t.id,
      content: t.content,
      editDeadline: t.edit_deadline,
      sharingEnabled: !!t.sharing_enabled,
      hasAnswered: !!myAnswer,
      myAnswerId: myAnswer ? myAnswer.id : null,
      answerCount,
      myThreadCount,
      threadsRemaining: Math.max(0, MAX_THREADS_PER_TOPIC - myThreadCount),
      createdAt: t.created_at,
    };
  });
}

function listAllTopicsForAdmin() {
  return db.prepare('SELECT * FROM msn_topics ORDER BY id DESC').all();
}

// ── 답변 ─────────────────────────────────────────

function submitAnswer(topicId, userId, content) {
  const existing = db.prepare('SELECT id FROM msn_answers WHERE topic_id = ? AND user_id = ?').get(topicId, userId);
  if (existing) {
    const err = new Error('이미 이 주제에 답변을 남겼어요.');
    err.code = 'ALREADY_ANSWERED';
    throw err;
  }
  const result = db
    .prepare('INSERT INTO msn_answers (topic_id, user_id, content) VALUES (?, ?, ?)')
    .run(topicId, userId, content.trim());
  return result.lastInsertRowid;
}

// 공유가 켜져 있고, 뷰어도 답변을 남긴 상태여야 남의 답변을 볼 수 있음
function getSharedAnswers(topicId, viewerUserId) {
  const topic = db.prepare('SELECT * FROM msn_topics WHERE id = ?').get(topicId);
  if (!topic) {
    const err = new Error('주제를 찾을 수 없어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const myAnswer = db.prepare('SELECT id FROM msn_answers WHERE topic_id = ? AND user_id = ?').get(topicId, viewerUserId);
  if (!topic.sharing_enabled || !myAnswer) {
    return { answers: [], canView: false };
  }

  const rows = db
    .prepare('SELECT id, user_id, content, created_at FROM msn_answers WHERE topic_id = ? ORDER BY id ASC')
    .all(topicId);

  const myThreads = db
    .prepare('SELECT answer_id FROM msn_threads WHERE topic_id = ? AND initiator_user_id = ?')
    .all(topicId, viewerUserId);
  const threadedAnswerIds = new Set(myThreads.map((t) => t.answer_id));

  const answers = rows.map((r) => ({
    id: r.id,
    isOwn: r.user_id === viewerUserId,
    content: r.content,
    createdAt: r.created_at,
    hasThread: threadedAnswerIds.has(r.id),
  }));

  return { answers, canView: true };
}

// ── 대화방(threads) ─────────────────────────────────────────

// 특정 답변에 말을 걸어 새 대화방을 시작 (동시에 첫 메시지 전송)
const startThread = db.transaction((topicId, initiatorUserId, answerId, firstMessage) => {
  const topic = db.prepare('SELECT * FROM msn_topics WHERE id = ?').get(topicId);
  if (!topic || !topic.sharing_enabled) {
    const err = new Error('지금은 대화를 시작할 수 없어요.');
    err.code = 'SHARING_DISABLED';
    throw err;
  }

  const myAnswer = db.prepare('SELECT id FROM msn_answers WHERE topic_id = ? AND user_id = ?').get(topicId, initiatorUserId);
  if (!myAnswer) {
    const err = new Error('이 주제에 먼저 답변을 남겨야 대화를 시작할 수 있어요.');
    err.code = 'NOT_ANSWERED';
    throw err;
  }

  const answer = db.prepare('SELECT * FROM msn_answers WHERE id = ? AND topic_id = ?').get(answerId, topicId);
  if (!answer) {
    const err = new Error('답변을 찾을 수 없어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (answer.user_id === initiatorUserId) {
    const err = new Error('내 답변에는 말을 걸 수 없어요.');
    err.code = 'SELF_THREAD';
    throw err;
  }

  const existing = db
    .prepare('SELECT id FROM msn_threads WHERE answer_id = ? AND initiator_user_id = ?')
    .get(answerId, initiatorUserId);
  if (existing) {
    const err = new Error('이미 이 사람에게 말을 걸었어요.');
    err.code = 'ALREADY_STARTED';
    throw err;
  }

  const threadCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM msn_threads WHERE topic_id = ? AND initiator_user_id = ?')
    .get(topicId, initiatorUserId).cnt;
  if (threadCount >= MAX_THREADS_PER_TOPIC) {
    const err = new Error(`한 주제당 최대 ${MAX_THREADS_PER_TOPIC}명에게만 말을 걸 수 있어요.`);
    err.code = 'THREAD_LIMIT';
    throw err;
  }

  const result = db
    .prepare(
      `INSERT INTO msn_threads (topic_id, answer_id, owner_user_id, initiator_user_id)
       VALUES (?, ?, ?, ?)`
    )
    .run(topicId, answerId, answer.user_id, initiatorUserId);
  const threadId = result.lastInsertRowid;

  db.prepare('INSERT INTO msn_thread_messages (thread_id, sender_user_id, content) VALUES (?, ?, ?)').run(
    threadId,
    initiatorUserId,
    firstMessage.trim()
  );

  // 답변 원 작성자에게 "누군가 말을 걸었다" 알림
  notifications.notify(answer.user_id, 'msn_reply', { threadId });

  return { threadId };
});

function getThreadRole(thread, userId) {
  if (thread.owner_user_id === userId) return 'owner';
  if (thread.initiator_user_id === userId) return 'initiator';
  return null;
}

const sendThreadMessage = db.transaction((threadId, userId, content) => {
  const thread = db.prepare('SELECT * FROM msn_threads WHERE id = ?').get(threadId);
  if (!thread) {
    const err = new Error('대화방을 찾을 수 없어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const role = getThreadRole(thread, userId);
  if (!role) {
    const err = new Error('이 대화방에 참여하고 있지 않아요.');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const topic = db.prepare('SELECT sharing_enabled FROM msn_topics WHERE id = ?').get(thread.topic_id);
  if (!topic || !topic.sharing_enabled) {
    const err = new Error('지금은 이 주제의 공유가 꺼져 있어서 메시지를 보낼 수 없어요.');
    err.code = 'SHARING_DISABLED';
    throw err;
  }

  const maxTurns = role === 'owner' ? OWNER_MAX_TURNS : INITIATOR_MAX_TURNS;
  const myCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM msn_thread_messages WHERE thread_id = ? AND sender_user_id = ?')
    .get(threadId, userId).cnt;
  if (myCount >= maxTurns) {
    const err = new Error('더 이상 보낼 수 있는 메시지가 없어요.');
    err.code = 'TURN_LIMIT';
    throw err;
  }

  db.prepare('INSERT INTO msn_thread_messages (thread_id, sender_user_id, content) VALUES (?, ?, ?)').run(
    threadId,
    userId,
    content.trim()
  );

  // 상대방에게 새 메시지 도착 알림
  const counterpartId = role === 'owner' ? thread.initiator_user_id : thread.owner_user_id;
  notifications.notify(counterpartId, 'msn_reply', { threadId });
});

function listMyThreads(userId) {
  const rows = db
    .prepare(
      `SELECT t.id, t.topic_id, t.owner_user_id, t.initiator_user_id, t.created_at,
              tp.sharing_enabled,
              (SELECT COUNT(*) FROM msn_thread_messages m WHERE m.thread_id = t.id) AS message_count,
              (SELECT MAX(created_at) FROM msn_thread_messages m WHERE m.thread_id = t.id) AS last_message_at
       FROM msn_threads t
       JOIN msn_topics tp ON tp.id = t.topic_id
       WHERE t.owner_user_id = ? OR t.initiator_user_id = ?
       ORDER BY last_message_at DESC`
    )
    .all(userId, userId);

  return rows
    .map((t) => {
      const role = t.owner_user_id === userId ? 'owner' : 'initiator';
      const ownerCount = db
        .prepare(`SELECT COUNT(*) AS cnt FROM msn_thread_messages WHERE thread_id = ? AND sender_user_id = ?`)
        .get(t.id, t.owner_user_id).cnt;
      const initiatorCount = db
        .prepare(`SELECT COUNT(*) AS cnt FROM msn_thread_messages WHERE thread_id = ? AND sender_user_id = ?`)
        .get(t.id, t.initiator_user_id).cnt;
      const exhausted = ownerCount >= OWNER_MAX_TURNS && initiatorCount >= INITIATOR_MAX_TURNS;
      const revealed = !!db.prepare('SELECT id FROM msn_thread_reveals WHERE thread_id = ? AND user_id = ?').get(t.id, userId);

      let counterpartNickname = null;
      if (revealed) {
        const counterpartId = role === 'owner' ? t.initiator_user_id : t.owner_user_id;
        counterpartNickname = db.prepare('SELECT nickname FROM users WHERE id = ?').get(counterpartId).nickname;
      }

      return {
        id: t.id,
        topicId: t.topic_id,
        role,
        messageCount: t.message_count,
        exhausted,
        revealed,
        counterpartNickname,
        myTurnsUsed: role === 'owner' ? ownerCount : initiatorCount,
        myTurnsMax: role === 'owner' ? OWNER_MAX_TURNS : INITIATOR_MAX_TURNS,
        lastMessageAt: t.last_message_at,
        // 대화가 끝나지 않았는데 주제 공유가 꺼져 있으면 목록에서 숨김 (완료된 대화는 꺼져도 계속 보임)
        _visible: exhausted || !!t.sharing_enabled,
      };
    })
    .filter((t) => t._visible)
    .map(({ _visible, ...rest }) => rest);
}

function getThreadMessages(threadId, userId) {
  const thread = db.prepare('SELECT * FROM msn_threads WHERE id = ?').get(threadId);
  if (!thread) {
    const err = new Error('대화방을 찾을 수 없어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const role = getThreadRole(thread, userId);
  if (!role) {
    const err = new Error('이 대화방에 참여하고 있지 않아요.');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const ownerMsgCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM msn_thread_messages WHERE thread_id = ? AND sender_user_id = ?')
    .get(threadId, thread.owner_user_id).cnt;
  const initiatorMsgCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM msn_thread_messages WHERE thread_id = ? AND sender_user_id = ?')
    .get(threadId, thread.initiator_user_id).cnt;
  const exhausted = ownerMsgCount >= OWNER_MAX_TURNS && initiatorMsgCount >= INITIATOR_MAX_TURNS;

  if (!exhausted) {
    const topic = db.prepare('SELECT sharing_enabled FROM msn_topics WHERE id = ?').get(thread.topic_id);
    if (!topic || !topic.sharing_enabled) {
      const err = new Error('지금은 이 주제의 공유가 꺼져 있어요.');
      err.code = 'SHARING_DISABLED';
      throw err;
    }
  }

  const messages = db
    .prepare('SELECT id, sender_user_id, content, created_at FROM msn_thread_messages WHERE thread_id = ? ORDER BY id ASC')
    .all(threadId)
    .map((m) => ({ id: m.id, isMine: m.sender_user_id === userId, content: m.content, createdAt: m.created_at }));

  const revealed = !!db.prepare('SELECT id FROM msn_thread_reveals WHERE thread_id = ? AND user_id = ?').get(threadId, userId);
  let counterpartNickname = null;
  if (revealed) {
    const counterpartId = role === 'owner' ? thread.initiator_user_id : thread.owner_user_id;
    counterpartNickname = db.prepare('SELECT nickname FROM users WHERE id = ?').get(counterpartId).nickname;
  }

  const myTurnsUsed = role === 'owner' ? ownerMsgCount : initiatorMsgCount;
  const myTurnsMax = role === 'owner' ? OWNER_MAX_TURNS : INITIATOR_MAX_TURNS;

  return {
    role,
    messages,
    exhausted,
    revealed,
    counterpartNickname,
    myTurnsUsed,
    myTurnsMax,
    myTurnsRemaining: Math.max(0, myTurnsMax - myTurnsUsed),
  };
}

// 열람권(pass) 아이템 1개를 소모해서, 다 소진된 대화방의 상대 닉네임을 공개 (내 입장에서만)
const revealThread = db.transaction((threadId, userId) => {
  const thread = db.prepare('SELECT * FROM msn_threads WHERE id = ?').get(threadId);
  if (!thread) {
    const err = new Error('대화방을 찾을 수 없어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const role = getThreadRole(thread, userId);
  if (!role) {
    const err = new Error('이 대화방에 참여하고 있지 않아요.');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const already = db.prepare('SELECT id FROM msn_thread_reveals WHERE thread_id = ? AND user_id = ?').get(threadId, userId);
  if (already) {
    const err = new Error('이미 공개했어요.');
    err.code = 'ALREADY_REVEALED';
    throw err;
  }

  const ownerMsgCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM msn_thread_messages WHERE thread_id = ? AND sender_user_id = ?')
    .get(threadId, thread.owner_user_id).cnt;
  const initiatorMsgCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM msn_thread_messages WHERE thread_id = ? AND sender_user_id = ?')
    .get(threadId, thread.initiator_user_id).cnt;
  const exhausted = ownerMsgCount >= OWNER_MAX_TURNS && initiatorMsgCount >= INITIATOR_MAX_TURNS;
  if (!exhausted) {
    const err = new Error('대화 기회를 다 쓴 뒤에만 열람권을 사용할 수 있어요.');
    err.code = 'NOT_EXHAUSTED';
    throw err;
  }

  const consumed = shop.consumePass(userId);
  if (!consumed) {
    const err = new Error('보유한 열람권이 없어요.');
    err.code = 'NO_PASS';
    throw err;
  }

  db.prepare('INSERT INTO msn_thread_reveals (thread_id, user_id) VALUES (?, ?)').run(threadId, userId);

  const counterpartId = role === 'owner' ? thread.initiator_user_id : thread.owner_user_id;
  const counterpart = db.prepare('SELECT nickname FROM users WHERE id = ?').get(counterpartId);
  return { counterpartNickname: counterpart.nickname };
});

// ── 관리자 조회 (기명) ─────────────────────────────────────────

function listAnswersForAdmin(topicId) {
  return db
    .prepare(
      `SELECT a.id, a.content, a.created_at, u.nickname
       FROM msn_answers a JOIN users u ON u.id = a.user_id
       WHERE a.topic_id = ? ORDER BY a.id ASC`
    )
    .all(topicId);
}

function listThreadsForAdmin(topicId) {
  const threads = db
    .prepare(
      `SELECT t.id, t.answer_id, t.created_at,
              owner.nickname AS owner_nickname, initiator.nickname AS initiator_nickname
       FROM msn_threads t
       JOIN users owner ON owner.id = t.owner_user_id
       JOIN users initiator ON initiator.id = t.initiator_user_id
       WHERE t.topic_id = ? ORDER BY t.id ASC`
    )
    .all(topicId);

  return threads.map((t) => ({
    ...t,
    messages: db
      .prepare(
        `SELECT m.content, m.created_at, u.nickname AS sender_nickname
         FROM msn_thread_messages m JOIN users u ON u.id = m.sender_user_id
         WHERE m.thread_id = ? ORDER BY m.id ASC`
      )
      .all(t.id),
  }));
}

module.exports = {
  MAX_THREADS_PER_TOPIC,
  OWNER_MAX_TURNS,
  INITIATOR_MAX_TURNS,
  createTopic,
  updateTopicContent,
  setSharingEnabled,
  listTopics,
  listAllTopicsForAdmin,
  submitAnswer,
  getSharedAnswers,
  startThread,
  sendThreadMessage,
  listMyThreads,
  getThreadMessages,
  revealThread,
  listAnswersForAdmin,
  listThreadsForAdmin,
};
