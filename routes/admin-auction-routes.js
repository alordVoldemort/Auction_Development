// routes/adminAuctionRoutes.js
const express = require('express');
const router = express.Router();
const adminAuctionController = require('../controllers/adminAuctionController');


// Get all auctions with filtering
router.get('/', adminAuctionController.getAuctions);

// Get auction by ID
router.get('/:id', adminAuctionController.getAuctionById);


// Update auction status
router.put('/:id/status', adminAuctionController.updateAuctionStatus);

// Update participant status
router.put('/:auctionId/participants/:participantId/status', adminAuctionController.updateParticipantStatus);

// Delete auction
router.delete('/:id', adminAuctionController.deleteAuction);


module.exports = router;