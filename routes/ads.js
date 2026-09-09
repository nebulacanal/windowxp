const express = require('express');
const ads = require('../db/ads');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

router.get('/', requireLogin, (req, res) => {
  res.json({ banners: ads.getAllBanners() });
});

module.exports = router;
