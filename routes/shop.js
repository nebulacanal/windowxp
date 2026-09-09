const express = require('express');
const shop = require('../db/shop');
const gacha = require('../db/gacha');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '로그인이 필요해요.' });
  }
  next();
}

// 구매 가능한 아이템 목록
router.get('/items', requireLogin, (req, res) => {
  res.json({ items: shop.listActiveItems() });
});

// 아이템 구매(전송)
router.post('/purchase', requireLogin, (req, res) => {
  const { itemId, toNickname, message, mp3Title, mp3YoutubeUrl } = req.body;
  if (!itemId) {
    return res.status(400).json({ error: 'itemId가 필요해요.' });
  }

  try {
    const result = shop.purchaseItem(req.session.userId, {
      itemId,
      toNickname,
      message,
      mp3Title,
      mp3YoutubeUrl,
    });
    res.status(201).json({ ok: true, purchaseId: result.purchaseId, gachaResult: result.gachaResult });
  } catch (err) {
    if (
      err.code === 'NOT_FOUND' ||
      err.code === 'NOT_AVAILABLE' ||
      err.code === 'RECIPIENT_NOT_FOUND' ||
      err.code === 'INVALID_MESSAGE' ||
      err.code === 'INVALID_TITLE' ||
      err.code === 'INVALID_URL' ||
      err.code === 'SELF_TARGET' ||
      err.code === 'ALREADY_UNLOCKED' ||
      err.code === 'NO_PRIZES'
    ) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 'INSUFFICIENT_POINTS') {
      return res.status(400).json({ error: '포인트가 부족해요.' });
    }
    res.status(500).json({ error: '구매에 실패했어요.' });
  }
});

// 내가 받은 아이템(선물/쪽지/mp3) + 보유 돋보기 개수
router.get('/inventory', requireLogin, (req, res) => {
  res.json({
    received: shop.listMyReceivedItems(req.session.userId),
    magnifierCount: shop.countUnusedMagnifiers(req.session.userId),
    purchased: shop.listMyPurchases(req.session.userId),
    used: shop.listMyUsedItems(req.session.userId),
  });
});

// 돋보기 사용해서 특정 아이템의 발신자 공개
router.post('/reveal', requireLogin, (req, res) => {
  const { targetPurchaseId } = req.body;
  if (!targetPurchaseId) {
    return res.status(400).json({ error: 'targetPurchaseId가 필요해요.' });
  }
  try {
    const result = shop.useMagnifier(req.session.userId, targetPurchaseId);
    res.json({ ok: true, senderNickname: result.senderNickname });
  } catch (err) {
    if (err.code === 'NO_MAGNIFIER' || err.code === 'INVALID_TARGET' || err.code === 'ALREADY_REVEALED') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: '공개에 실패했어요.' });
  }
});

// 뽑기 내역 (내가 뽑은 것)
router.get('/gacha/history', requireLogin, (req, res) => {
  res.json({ draws: gacha.listMyDraws(req.session.userId) });
});

module.exports = router;
