const express = require('express');
const router = express.Router();
const auctionController = require('../controllers/auctionDetailController');


router.get("/", auctionController.getAllAuctions);
// Route to get auction details
router.get('/:id/details', auctionController.getAuctionDetails);
router.get('/:id/bids', auctionController.getAuctionBids);
router.get("/auctions", auctionController.getAllAuctions);
router.get("/auctions/:id/report", auctionController.getAuctionReport);
module.exports = router;
