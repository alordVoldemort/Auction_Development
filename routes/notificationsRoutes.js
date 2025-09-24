const express = require('express');
const router = express.Router();
// const { authMiddleware } = require('../middleware/authMiddleware');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware.authenticateToken);

const {
  getMyNotifications,
  getParticipantNotifications,
  markAsRead         
} = require('../controllers/notificationsController');

router.get('/my-notification',  getMyNotifications);
router.get('/notifications/participants/:auctionId',  getParticipantNotifications);

router.patch('/notifications/:id/read', markAsRead);

module.exports = router;
