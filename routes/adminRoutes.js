// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyAdminToken } = require('../controllers/adminAuthController');

router.use(verifyAdminToken);

// Dashboard routes
router.get('/admin/dashboard', adminController.getAdminDashboard);


module.exports = router;