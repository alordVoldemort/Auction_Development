const express = require('express');
const router = express.Router();
const authController = require('../controllers/user-auth-controller.js');
const authMiddleware = require('../middleware/authMiddleware');

// Signup route
router.post('/signup', authController.signup);

// OTP login routes
router.post('/send-otp', authController.sendLoginOTP);
router.post('/verify-otp', authController.verifyLoginOTP);

// Profile route (protected)
router.get('/profile', authMiddleware.authenticateToken, authController.getProfile);
// In your routes file:
router.put('/profile/:user_id', authMiddleware.authenticateToken, authController.editProfileByID);

module.exports = router;