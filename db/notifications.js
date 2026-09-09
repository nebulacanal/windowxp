const db = require('./db');

function notify(userId, type, payload) {
  db.prepare('INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)').run(
    userId,
    type,
    JSON.stringify(payload || {})
  );
}

function notifyMany(userIds, type, payload) {
  const stmt = db.prepare('INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)');
  const json = JSON.stringify(payload || {});
  const insertMany = db.transaction((ids) => {
    for (const id of ids) stmt.run(id, type, json);
  });
  insertMany(userIds);
}

module.exports = { notify, notifyMany };
