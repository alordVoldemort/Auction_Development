const express = require('express');
const router = express.Router();
const myAuctionsController = require('../controllers/myAuctionsController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware.authenticateToken);

// router.get('/stats', myAuctionsController.getAuctionStats);
router.get('/timers', myAuctionsController.getAuctionTimers);

module.exports = router;