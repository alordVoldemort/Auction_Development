const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const authMiddleware = require('../middleware/authMiddleware');

// CORRECTED: Use the proper middleware function
router.get('/fulldashboard', authMiddleware.authenticateToken, dashboardController.getDashboard);


module.exports = router;