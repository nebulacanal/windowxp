const Database = require('better-sqlite3');
const path = require('path');

// DB 파일 위치. DB_DIR 환경변수가 있으면 그쪽에 저장합니다.
// 렌더(Render) 등에서 서버가 재시작되면 로컬 파일시스템 내용이 사라질 수 있으니,
// Persistent Disk를 만들어서 그 마운트 경로를 DB_DIR로 지정하면 재시작해도 데이터가 유지됩니다.
const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..');
const db = new Database(path.join(DB_DIR, 'data.sqlite'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    preference TEXT NOT NULL DEFAULT 'top', -- 'top'(탑부치) | 'bottom'(바텀팸)
    curriculum_gay INTEGER NOT NULL DEFAULT 0,
    curriculum_lesbian INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
    is_admin INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    profile_note TEXT NOT NULL DEFAULT '', -- '내 문서'에 표시될 자기소개
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS point_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL, -- 양수: 적립, 음수: 차감
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL, -- 사람이 읽을 수 있는 설명 (예: "피드 댓글 보상")
    ref_type TEXT, -- 'feed_comment' | 'shop_purchase' | 'admin_adjust' | 'comment_reclaim' 등
    ref_id INTEGER, -- 관련 레코드 id (댓글 id, 주문 id 등)
    created_by INTEGER, -- 관리자가 수동 지급/차감한 경우 그 관리자의 user id
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_point_tx_user ON point_transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_point_tx_ref ON point_transactions(ref_type, ref_id);

  CREATE TABLE IF NOT EXISTS pokes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_pokes_from ON pokes(from_user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_pokes_to ON pokes(to_user_id);

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, -- 알림을 받는 사람
    type TEXT NOT NULL, -- 'poke' 등, 나중에 다른 알림 유형도 추가될 수 있음
    payload TEXT, -- JSON 문자열 (예: 관련 id 등, 익명이라 발신자 정보는 넣지 않음)
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

  CREATE TABLE IF NOT EXISTS memo_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, -- 실제 작성자 (화면엔 표시 안 되고, 나중에 관리자 조회용으로만 사용)
    anon_number INTEGER NOT NULL, -- 1~9999, 현재 남아있는 메모들 사이에서 겹치지 않게 부여됨
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_memo_notes_created ON memo_notes(created_at);

  CREATE TABLE IF NOT EXISTS soribada_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_user_id INTEGER NOT NULL, -- 받는 사람 (본인 소리바다 목록에 뜸)
    sender_user_id INTEGER, -- 실제 보낸 사람 (화면엔 안 보이고, 관리자 조회용) -- 익명이라 nullable 허용
    title TEXT NOT NULL, -- 띄어쓰기 없는 8글자 제목
    youtube_url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (recipient_user_id) REFERENCES users(id),
    FOREIGN KEY (sender_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_soribada_recipient ON soribada_tracks(recipient_user_id);

  CREATE TABLE IF NOT EXISTS feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER NOT NULL, -- 작성한 관리자
    type TEXT NOT NULL, -- 'normal' | 'participatory' | 'secret'
    content TEXT NOT NULL,
    point_reward INTEGER NOT NULL DEFAULT 0, -- 댓글 작성 시 지급할 포인트
    unlock_price INTEGER NOT NULL DEFAULT 0, -- 비밀 피드일 때, 남의 댓글 열람 비용
    publish_at TEXT NOT NULL DEFAULT (datetime('now')), -- 예약 발행 시각 (지나야 회원에게 보임)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (author_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_feeds_publish ON feeds(publish_at);

  CREATE TABLE IF NOT EXISTS feed_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (feed_id) REFERENCES feeds(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_feed_comments_feed ON feed_comments(feed_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_feed_comments_user ON feed_comments(feed_id, user_id);

  CREATE TABLE IF NOT EXISTS feed_comment_unlocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(comment_id, user_id),
    FOREIGN KEY (comment_id) REFERENCES feed_comments(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS shop_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- 'gift' | 'anon_note' | 'mp3' | 'magnifier' | 'pass' | 'nameplate' | 'coin' | 'gacha'
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    icon TEXT NOT NULL DEFAULT '🎁',
    description TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS item_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    item_type TEXT NOT NULL, -- 구매 당시 스냅샷 (나중에 아이템이 수정/삭제돼도 기록은 유지)
    item_name TEXT NOT NULL,
    buyer_user_id INTEGER NOT NULL,
    recipient_user_id INTEGER NOT NULL, -- 돋보기는 buyer=recipient (자기 자신용)
    message TEXT, -- 익명 쪽지 내용
    extra_data TEXT, -- JSON (mp3 제목/링크 등)
    used INTEGER NOT NULL DEFAULT 0, -- 돋보기처럼 '사용'하는 아이템의 소모 여부
    revealed INTEGER NOT NULL DEFAULT 0, -- 선물/쪽지가 돋보기로 발신자 공개됐는지
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (item_id) REFERENCES shop_items(id),
    FOREIGN KEY (buyer_user_id) REFERENCES users(id),
    FOREIGN KEY (recipient_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_item_purchases_recipient ON item_purchases(recipient_user_id, item_type);
  CREATE INDEX IF NOT EXISTS idx_item_purchases_buyer ON item_purchases(buyer_user_id);

  CREATE TABLE IF NOT EXISTS msn_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    edit_deadline TEXT, -- 이 시각까지만 관리자가 내용 수정 가능 (NULL이면 제한 없음)
    sharing_enabled INTEGER NOT NULL DEFAULT 0, -- 켜져있는 동안만 답변자들끼리 서로 공유됨
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS msn_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(topic_id, user_id),
    FOREIGN KEY (topic_id) REFERENCES msn_topics(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS msn_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL,
    answer_id INTEGER NOT NULL, -- 어떤 익명 답변에 말을 건 건지
    owner_user_id INTEGER NOT NULL, -- 그 답변을 쓴 사람 (최대 2턴)
    initiator_user_id INTEGER NOT NULL, -- 말을 건 사람 (최대 3턴)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(answer_id, initiator_user_id),
    FOREIGN KEY (topic_id) REFERENCES msn_topics(id),
    FOREIGN KEY (answer_id) REFERENCES msn_answers(id),
    FOREIGN KEY (owner_user_id) REFERENCES users(id),
    FOREIGN KEY (initiator_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_msn_threads_initiator ON msn_threads(topic_id, initiator_user_id);
  CREATE INDEX IF NOT EXISTS idx_msn_threads_owner ON msn_threads(owner_user_id);

  CREATE TABLE IF NOT EXISTS msn_thread_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    sender_user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES msn_threads(id),
    FOREIGN KEY (sender_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_msn_thread_messages_thread ON msn_thread_messages(thread_id, created_at);

  CREATE TABLE IF NOT EXISTS msn_thread_reveals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, -- 이 사람 입장에서 상대가 공개됨
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(thread_id, user_id),
    FOREIGN KEY (thread_id) REFERENCES msn_threads(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS taste_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL DEFAULT 'text', -- 'text' | 'radio' | 'checkbox'
    options TEXT, -- JSON 배열 문자열, radio/checkbox일 때만 사용
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS taste_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    answer_text TEXT NOT NULL DEFAULT '', -- text/radio: 그대로, checkbox: JSON 배열 문자열
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, question_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (question_id) REFERENCES taste_questions(id)
  );

  CREATE TABLE IF NOT EXISTS menu_settings (
    menu_key TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS exchange_diary_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS exchange_diary_pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a_id INTEGER NOT NULL,
    user_b_id INTEGER NOT NULL,
    revealed_to_a INTEGER NOT NULL DEFAULT 0, -- a가 b의 정체를 이름표로 공개했는지
    revealed_to_b INTEGER NOT NULL DEFAULT 0,
    guess_a INTEGER, -- a가 추측한 상대 user_id
    guess_b INTEGER,
    guess_result TEXT, -- 'both_correct' | 'one_correct' | 'both_wrong' (둘 다 추측 제출해야 계산됨)
    final_unlocked INTEGER NOT NULL DEFAULT 0, -- 마지막 자유 대화장 열렸는지
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_a_id) REFERENCES users(id),
    FOREIGN KEY (user_b_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS diary_chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_number INTEGER NOT NULL,
    topic_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS diary_chapter_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(chapter_id, user_id),
    FOREIGN KEY (chapter_id) REFERENCES diary_chapters(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS diary_final_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (pair_id) REFERENCES exchange_diary_pairs(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS diary_event_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    guessing_open INTEGER NOT NULL DEFAULT 0,
    finished INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS gacha_prizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 1, -- 상대적 확률 가중치
    point_reward INTEGER NOT NULL DEFAULT 0, -- 당첨 시 자동 지급할 포인트 (0이면 텍스트 상품)
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gacha_draws (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    prize_id INTEGER,
    prize_name TEXT NOT NULL,
    point_reward INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (prize_id) REFERENCES gacha_prizes(id)
  );

  CREATE INDEX IF NOT EXISTS idx_gacha_draws_user ON gacha_draws(user_id);

  CREATE TABLE IF NOT EXISTS ad_banners (
    slot TEXT PRIMARY KEY, -- 'large' | 'small1' | 'small2'
    image_url TEXT NOT NULL DEFAULT '',
    link_url TEXT NOT NULL DEFAULT ''
  );
`);

// 기존 DB에 preference/points/profile_note 컬럼이 없을 수도 있으니 안전하게 추가 (이미 있으면 무시)
try {
  db.exec("ALTER TABLE users ADD COLUMN preference TEXT NOT NULL DEFAULT 'top'");
} catch (err) {
  // 컬럼이 이미 있으면 에러가 나는데, 정상적인 상황이라 무시합니다.
}
try {
  db.exec('ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0');
} catch (err) {
  // 이미 있으면 무시
}
try {
  db.exec("ALTER TABLE users ADD COLUMN profile_note TEXT NOT NULL DEFAULT ''");
} catch (err) {
  // 이미 있으면 무시
}
try {
  db.exec("ALTER TABLE users ADD COLUMN profile_image_url TEXT NOT NULL DEFAULT ''");
} catch (err) {
  // 이미 있으면 무시
}
try {
  db.exec('ALTER TABLE users ADD COLUMN curriculum_gay INTEGER NOT NULL DEFAULT 0');
} catch (err) {
  // 이미 있으면 무시
}
try {
  db.exec('ALTER TABLE users ADD COLUMN curriculum_lesbian INTEGER NOT NULL DEFAULT 0');
} catch (err) {
  // 이미 있으면 무시
}
try {
  db.exec("ALTER TABLE taste_questions ADD COLUMN question_type TEXT NOT NULL DEFAULT 'text'");
} catch (err) {
  // 이미 있으면 무시
}
try {
  db.exec('ALTER TABLE taste_questions ADD COLUMN options TEXT');
} catch (err) {
  // 이미 있으면 무시
}
try {
  db.exec('ALTER TABLE exchange_diary_pairs ADD COLUMN guess_a INTEGER');
} catch (err) {
  // 이미 있으면 무시
}
try {
  db.exec('ALTER TABLE exchange_diary_pairs ADD COLUMN guess_b INTEGER');
} catch (err) {
  // 이미 있으면 무시
}
try {
  db.exec('ALTER TABLE exchange_diary_pairs ADD COLUMN guess_result TEXT');
} catch (err) {
  // 이미 있으면 무시
}
try {
  db.exec('ALTER TABLE exchange_diary_pairs ADD COLUMN final_unlocked INTEGER NOT NULL DEFAULT 0');
} catch (err) {
  // 이미 있으면 무시
}
try {
  db.exec("INSERT OR IGNORE INTO diary_event_state (id, guessing_open, finished) VALUES (1, 0, 0)");
} catch (err) {
  // 이미 있으면 무시
}

// 서버 시작 시, 승인된 관리자가 한 명도 없으면 환경변수로 초기 관리자를 만들어 둡니다.
// Render 등에 배포할 때 ADMIN_NICKNAME / ADMIN_PASSWORD 환경변수를 설정해 주세요.
function ensureInitialAdmin() {
  const existingAdmin = db.prepare('SELECT id FROM users WHERE is_admin = 1').get();
  if (existingAdmin) return;

  const nickname = process.env.ADMIN_NICKNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!nickname || !password) {
    console.warn(
      '[7979] 관리자 계정이 없어요. ADMIN_NICKNAME / ADMIN_PASSWORD 환경변수를 설정하면 서버 시작 시 자동으로 관리자 계정이 만들어져요.'
    );
    return;
  }

  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync(password, 10);
  const existing = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname);
  if (existing) {
    db.prepare("UPDATE users SET is_admin = 1, status = 'approved' WHERE id = ?").run(existing.id);
  } else {
    db.prepare(
      "INSERT INTO users (nickname, password_hash, status, is_admin, approved_at) VALUES (?, ?, 'approved', 1, datetime('now'))"
    ).run(nickname, passwordHash);
  }
  console.log(`[7979] 관리자 계정 "${nickname}" 준비 완료.`);
}

ensureInitialAdmin();

module.exports = db;
