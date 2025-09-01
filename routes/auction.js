const express = require('express');
const router = express.Router();
const auctionController = require('../controllers/auctionController');
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');


router.use(authMiddleware.authenticateToken);

router.post('/create', upload.array('documents', 3), auctionController.createAuction);
router.get('/my-auctions', auctionController.getUserAuctions);
router.get('/live', auctionController.getLiveAuctions);
router.get('/:id', auctionController.getAuctionDetails);
router.post('/bid', auctionController.placeBid);
router.post('/:id/close', auctionController.closeAuction);
router.post('/participants/add', auctionController.addParticipants);
router.get('/:auction_id/participants', auctionController.getParticipants);
router.post('/join', auctionController.joinAuction);



// Add these new routes for My Auctions UI
// router.get('/dashboard/stats', auctionController.getUserDashboard);
router.get('/list/filtered', auctionController.getFilteredAuctions);
router.post('/:id/start', auctionController.startAuction);
router.post('/:id/join-auctioneer', auctionController.joinAsAuctioneer);
router.get('/:id/report', auctionController.downloadReport);

module.exports = router;