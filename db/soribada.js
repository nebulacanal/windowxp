const db = require('./db');

const TITLE_LENGTH = 8;

function validateTitle(title) {
  if (typeof title !== 'string') return '제목을 입력해 주세요.';
  if (/\s/.test(title)) return '제목에는 띄어쓰기를 넣을 수 없어요.';
  if (title.length !== TITLE_LENGTH) return `제목은 정확히 ${TITLE_LENGTH}글자여야 해요.`;
  return null;
}

// 유튜브 링크에서 영상 ID를 뽑아냅니다 (watch?v=, youtu.be/, embed/ 형태 모두 지원)
function extractYoutubeId(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
    }
  } catch (err) {
    return null;
  }
  return null;
}

function validateYoutubeUrl(url) {
  const id = extractYoutubeId(url);
  if (!id) return { error: '올바른 유튜브 링크를 입력해 주세요.' };
  return { videoId: id };
}

// 파일명 형식: "제목-받는사람닉네임.mp3"
function buildFileName(title, recipientNickname) {
  return `${title}-${recipientNickname}.mp3`;
}

function sendTrack({ senderUserId, recipientUserId, title, youtubeUrl }) {
  const titleError = validateTitle(title);
  if (titleError) {
    const err = new Error(titleError);
    err.code = 'INVALID_TITLE';
    throw err;
  }

  const { videoId, error } = validateYoutubeUrl(youtubeUrl);
  if (error) {
    const err = new Error(error);
    err.code = 'INVALID_URL';
    throw err;
  }

  const recipient = db.prepare("SELECT id, nickname FROM users WHERE id = ? AND status = 'approved'").get(recipientUserId);
  if (!recipient) {
    const err = new Error('받는 사람을 찾을 수 없어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const result = db
    .prepare(
      `INSERT INTO soribada_tracks (recipient_user_id, sender_user_id, title, youtube_url)
       VALUES (?, ?, ?, ?)`
    )
    .run(recipientUserId, senderUserId, title, youtubeUrl.trim());

  return {
    id: result.lastInsertRowid,
    fileName: buildFileName(title, recipient.nickname),
    videoId,
  };
}

function listMyTracks(userId) {
  const rows = db
    .prepare(
      `SELECT st.id, st.title, st.youtube_url, st.created_at, u.nickname AS recipient_nickname
       FROM soribada_tracks st JOIN users u ON u.id = st.recipient_user_id
       WHERE st.recipient_user_id = ? ORDER BY st.id DESC`
    )
    .all(userId);

  return rows.map((r) => ({
    id: r.id,
    fileName: buildFileName(r.title, r.recipient_nickname),
    videoId: extractYoutubeId(r.youtube_url),
    createdAt: r.created_at,
  }));
}

// 관리자용: 보낸 사람까지 같이 조회 (모더레이션용)
function listAllTracksForAdmin() {
  const rows = db
    .prepare(
      `SELECT st.id, st.title, st.youtube_url, st.created_at,
              recv.nickname AS recipient_nickname, send.nickname AS sender_nickname
       FROM soribada_tracks st
       JOIN users recv ON recv.id = st.recipient_user_id
       LEFT JOIN users send ON send.id = st.sender_user_id
       ORDER BY st.id DESC`
    )
    .all();
  return rows;
}

module.exports = {
  TITLE_LENGTH,
  validateTitle,
  extractYoutubeId,
  buildFileName,
  sendTrack,
  listMyTracks,
  listAllTracksForAdmin,
};
