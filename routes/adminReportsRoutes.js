const express = require('express');
const router = express.Router();
const adminReportsController = require('../controllers/adminReportsController');

// Overview reports with filters: today, this_week, this_month, this_year
router.get('/overview', adminReportsController.getOverview);

// GET /api/admin/reports/auction-performance?filter=this_week
router.get('/report/auction-performance', adminReportsController.getAuctionPerformanceReport);

// GET /api/admin/reports/user-activity?filter=this_week
router.get('/reports/user-activity', adminReportsController.getUserActivityReport);

// // Revenue Analytics Routes
// router.get('/revenue-analytics', adminReportsController.getRevenueAnalytics);
// router.get('/revenue-by-range', adminReportsController.getRevenueByDateRange);

module.exports = router;
