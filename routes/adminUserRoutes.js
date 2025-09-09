const express = require('express');
const router = express.Router();
const adminUserController = require('../controllers/adminUserController');
// const { verifyAdminToken } = require('../controllers/adminAuthController');

// // Apply admin authentication middleware to all routes
// router.use(verifyAdminToken);

// User management routes
router.get('/users', adminUserController.getAllUsers);
router.get('/users/:id', adminUserController.getUserById);
router.patch('/users/:id/status', adminUserController.updateUserStatus);
// router.delete('/users/:id', adminUserController.deleteUser);
// router.post('/users/bulk-actions', adminUserController.bulkUserActions);


module.exports = router;