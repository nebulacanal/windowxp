const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/db');

const router = express.Router();

const NICKNAME_RULE = /^[가-힣a-zA-Z0-9]{2,12}$/;

function validateNickname(nickname) {
  if (typeof nickname !== 'string') return '닉네임을 입력해 주세요.';
  if (!NICKNAME_RULE.test(nickname)) {
    return '닉네임은 한글/영문/숫자 2~12자로 입력해 주세요.';
  }
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 4) {
    return '비밀번호는 4자 이상으로 입력해 주세요.';
  }
  if (password.length > 64) {
    return '비밀번호가 너무 깁니다.';
  }
  return null;
}

function validatePreference(preference) {
  if (preference !== 'top' && preference !== 'bottom') {
    return '성향(탑/바텀)을 선택해 주세요.';
  }
  return null;
}

// 회원가입 (관리자 승인 전까지는 로그인 불가한 대기 상태로 생성)
router.post('/signup', (req, res) => {
  const { nickname, password, preference } = req.body;

  const nicknameError = validateNickname(nickname);
  if (nicknameError) return res.status(400).json({ error: nicknameError });

  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const preferenceError = validatePreference(preference);
  if (preferenceError) return res.status(400).json({ error: preferenceError });

  const existing = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname);
  if (existing) {
    return res.status(409).json({ error: '이미 사용 중인 닉네임이에요.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(
    "INSERT INTO users (nickname, password_hash, preference, status) VALUES (?, ?, ?, 'pending')"
  ).run(nickname, passwordHash, preference);

  // 승인 전에는 세션을 만들지 않습니다 (바로 로그인시키지 않음).
  res.status(201).json({
    status: 'pending',
    message: '가입 신청이 접수됐어요. 관리자가 승인하면 로그인할 수 있어요.',
  });
});

// 로그인
router.post('/login', (req, res) => {
  const { nickname, password } = req.body;

  if (!nickname || !password) {
    return res.status(400).json({ error: '닉네임과 비밀번호를 입력해 주세요.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '닉네임 또는 비밀번호가 일치하지 않아요.' });
  }

  if (user.status === 'pending') {
    return res.status(403).json({ error: '아직 관리자 승인 대기 중이에요. 승인 후 다시 로그인해 주세요.', status: 'pending' });
  }
  if (user.status === 'rejected') {
    return res.status(403).json({ error: '가입이 승인되지 않았어요.', status: 'rejected' });
  }

  req.session.userId = user.id;
  req.session.nickname = user.nickname;
  req.session.isAdmin = !!user.is_admin;

  res.json({ nickname: user.nickname, isAdmin: !!user.is_admin });
});

// 로그아웃
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// 현재 로그인 상태 확인
router.get('/me', (req, res) => {
  if (req.session && req.session.nickname) {
    return res.json({ nickname: req.session.nickname, isAdmin: !!req.session.isAdmin });
  }
  res.status(401).json({ error: '로그인이 필요해요.' });
});

module.exports = router;
