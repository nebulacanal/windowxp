const db = require('./db');
const points = require('./points');
const notifications = require('./notifications');

const FEED_TYPES = ['normal', 'participatory', 'secret'];
const COMMENT_RECLAIM_WINDOW_MINUTES = 5;
const PREVIEW_COMMENT_COUNT = 2;

function validateFeedInput({ type, content, pointReward, unlockPrice }) {
  if (!FEED_TYPES.includes(type)) return '피드 종류가 올바르지 않아요.';
  if (typeof content !== 'string' || content.trim().length === 0) return '피드 내용을 입력해 주세요.';
  if (!Number.isInteger(pointReward) || pointReward < 0) return '댓글 보상 포인트는 0 이상의 정수여야 해요.';
  if (!Number.isInteger(unlockPrice) || unlockPrice < 0) return '열람 가격은 0 이상의 정수여야 해요.';
  return null;
}

function createFeed({ authorId, type, content, pointReward, unlockPrice, publishAt }) {
  const result = db
    .prepare(
      `INSERT INTO feeds (author_id, type, content, point_reward, unlock_price, publish_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
    )
    .run(authorId, type, content.trim(), pointReward, unlockPrice, publishAt || null);
  return result.lastInsertRowid;
}

// 특정 사용자가 특정 피드에 이미 댓글을 단 적 있는지
function hasCommented(feedId, userId) {
  const row = db
    .prepare('SELECT id FROM feed_comments WHERE feed_id = ? AND user_id = ? LIMIT 1')
    .get(feedId, userId);
  return !!row;
}

// 댓글 하나를 뷰어(viewerUserId) 입장에서 어떻게 보여줄지 처리 (참여형/비밀 피드의 블러/잠금 로직)
function shapeComment(comment, feed, viewerUserId, viewerHasCommented, unlockedCommentIds) {
  const isOwn = comment.user_id === viewerUserId;
  const base = {
    id: comment.id,
    nickname: comment.nickname,
    createdAt: comment.created_at,
    isOwn,
  };

  if (feed.type === 'participatory' && !isOwn && !viewerHasCommented) {
    return { ...base, locked: true, lockReason: 'need_comment', content: null, contentLength: comment.content.length };
  }

  if (feed.type === 'secret' && !isOwn && !unlockedCommentIds.has(comment.id)) {
    return {
      ...base,
      locked: true,
      lockReason: 'need_unlock',
      unlockPrice: feed.unlock_price,
      content: null,
      contentLength: comment.content.length,
    };
  }

  return { ...base, locked: false, content: comment.content };
}

function getCommentsForFeed(feedId, viewerUserId, { previewOnly = false } = {}) {
  const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(feedId);
  if (!feed) {
    const err = new Error('피드를 찾을 수 없어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const rows = db
    .prepare(
      `SELECT fc.id, fc.user_id, fc.content, fc.created_at, u.nickname
       FROM feed_comments fc JOIN users u ON u.id = fc.user_id
       WHERE fc.feed_id = ? ORDER BY fc.id ASC`
    )
    .all(feedId);

  const viewerHasCommented = hasCommented(feedId, viewerUserId);

  let unlockedCommentIds = new Set();
  if (feed.type === 'secret') {
    const unlockRows = db
      .prepare(
        `SELECT comment_id FROM feed_comment_unlocks
         WHERE user_id = ? AND comment_id IN (SELECT id FROM feed_comments WHERE feed_id = ?)`
      )
      .all(viewerUserId, feedId);
    unlockedCommentIds = new Set(unlockRows.map((r) => r.comment_id));
  }

  const totalCount = rows.length;
  const targetRows = previewOnly ? rows.slice(-PREVIEW_COMMENT_COUNT) : rows;

  const comments = targetRows.map((c) => shapeComment(c, feed, viewerUserId, viewerHasCommented, unlockedCommentIds));

  return { comments, totalCount };
}

function listPublishedFeeds(viewerUserId, limit = 50) {
  const feeds = db
    .prepare(
      `SELECT id, type, content, point_reward, unlock_price, publish_at, created_at
       FROM feeds WHERE publish_at <= datetime('now') ORDER BY publish_at DESC LIMIT ?`
    )
    .all(limit);

  return feeds.map((feed) => {
    const { comments, totalCount } = getCommentsForFeed(feed.id, viewerUserId, { previewOnly: true });
    return {
      id: feed.id,
      type: feed.type,
      content: feed.content,
      pointReward: feed.point_reward,
      unlockPrice: feed.unlock_price,
      publishAt: feed.publish_at,
      commentCount: totalCount,
      previewComments: comments,
    };
  });
}

function listAllFeedsForAdmin() {
  return db
    .prepare(
      `SELECT f.id, f.type, f.content, f.point_reward, f.unlock_price, f.publish_at, f.created_at,
              u.nickname AS author_nickname,
              (SELECT COUNT(*) FROM feed_comments fc WHERE fc.feed_id = f.id) AS comment_count
       FROM feeds f JOIN users u ON u.id = f.author_id
       ORDER BY f.publish_at DESC`
    )
    .all();
}

// 댓글 작성: 댓글 저장 + (보상 포인트가 있으면) 즉시 지급
const addComment = db.transaction((feedId, userId, content) => {
  const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(feedId);
  if (!feed) {
    const err = new Error('피드를 찾을 수 없어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const result = db
    .prepare('INSERT INTO feed_comments (feed_id, user_id, content) VALUES (?, ?, ?)')
    .run(feedId, userId, content.trim());
  const commentId = result.lastInsertRowid;

  if (feed.point_reward > 0) {
    points.earnPoints(userId, feed.point_reward, '피드 댓글 작성 보상', {
      refType: 'feed_comment',
      refId: commentId,
    });
  }

  return { commentId };
});

// 댓글 삭제: 본인 댓글만, 5분 이내면 지급됐던 포인트도 같이 회수
const deleteComment = db.transaction((commentId, userId) => {
  const comment = db.prepare('SELECT * FROM feed_comments WHERE id = ?').get(commentId);
  if (!comment) {
    const err = new Error('댓글을 찾을 수 없어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (comment.user_id !== userId) {
    const err = new Error('본인 댓글만 삭제할 수 있어요.');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const elapsedRow = db
    .prepare(`SELECT (strftime('%s','now') - strftime('%s', created_at)) AS elapsed_seconds FROM feed_comments WHERE id = ?`)
    .get(commentId);
  const withinWindow = elapsedRow.elapsed_seconds <= COMMENT_RECLAIM_WINDOW_MINUTES * 60;

  let reclaimed = false;
  if (withinWindow) {
    const result = points.reclaimByRef('feed_comment', commentId, '댓글 삭제로 인한 포인트 회수');
    reclaimed = !!result;
  }

  db.prepare('DELETE FROM feed_comment_unlocks WHERE comment_id = ?').run(commentId);
  db.prepare('DELETE FROM feed_comments WHERE id = ?').run(commentId);

  return { reclaimed };
});

// 비밀 댓글 열람 (포인트 차감 후 잠금 해제)
const unlockComment = db.transaction((commentId, viewerUserId) => {
  const comment = db.prepare('SELECT * FROM feed_comments WHERE id = ?').get(commentId);
  if (!comment) {
    const err = new Error('댓글을 찾을 수 없어요.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(comment.feed_id);
  if (!feed || feed.type !== 'secret') {
    const err = new Error('비밀 댓글이 아니에요.');
    err.code = 'NOT_SECRET';
    throw err;
  }
  if (comment.user_id === viewerUserId) {
    return { content: comment.content, alreadyOwn: true };
  }

  const already = db
    .prepare('SELECT id FROM feed_comment_unlocks WHERE comment_id = ? AND user_id = ?')
    .get(commentId, viewerUserId);
  if (already) {
    return { content: comment.content, alreadyUnlocked: true };
  }

  if (feed.unlock_price > 0) {
    points.spendPoints(viewerUserId, feed.unlock_price, '비밀 댓글 열람', {
      refType: 'feed_comment_unlock',
      refId: commentId,
    });
  }

  db.prepare('INSERT INTO feed_comment_unlocks (comment_id, user_id) VALUES (?, ?)').run(commentId, viewerUserId);

  // 댓글 작성자에게 "누군가 내 비밀 댓글을 열람했어요" 알림 (열람한 사람이 누군지는 알리지 않음)
  notifications.notify(comment.user_id, 'feed_comment_unlocked', { commentId, feedId: comment.feed_id });

  return { content: comment.content };
});

module.exports = {
  FEED_TYPES,
  COMMENT_RECLAIM_WINDOW_MINUTES,
  validateFeedInput,
  createFeed,
  listPublishedFeeds,
  listAllFeedsForAdmin,
  getCommentsForFeed,
  addComment,
  deleteComment,
  unlockComment,
};
