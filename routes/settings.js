const express = require('express');
const menuSettings = require('../db/menuSettings');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

router.get('/menus', requireLogin, (req, res) => {
  res.json({ menus: menuSettings.getAllMenuStatus() });
});

module.exports = router;
