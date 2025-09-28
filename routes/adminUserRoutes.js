const express = require('express');
const router = express.Router();
const adminUserController = require('../controllers/adminUserController');
const { verifyAdminToken } = require('../controllers/adminAuthController');

// Apply admin authentication middleware to all routes
router.use(verifyAdminToken);

// User management routes
router.get('/users', adminUserController.getAllUsers);
router.get('/users/:id', adminUserController.getUserById);
router.patch('/users/:id/status', adminUserController.updateUserStatus);

// Block/unblock routes - FIXED: Added /users prefix
router.put('/users/:id/block', adminUserController.blockUser);
router.put('/users/:id/unblock', adminUserController.unblockUser);
// router.delete('/users/:id', adminUserController.deleteUser);
// router.post('/users/bulk-actions', adminUserController.bulkUserActions);


module.exports = router;
