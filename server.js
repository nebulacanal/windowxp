const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'db') }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-this-in-render-env-vars',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7일
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);

// 로그인이 필요한 API를 보호하기 위한 미들웨어 (다음 단계인 게시판/채팅에서 사용 예정)
function requireLogin(req, res, next) {
  if (!req.session || !req.session.nickname) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}
module.exports.requireLogin = requireLogin;

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
