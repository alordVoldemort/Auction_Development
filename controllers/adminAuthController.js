// const db = require('../db');
// const jwt = require('jsonwebtoken');

// // Fixed admin credentials
// const ADMIN_PHONE = '9999999999';
// const FIXED_OTP = '123456';
// const ADMIN_DATA = {
//   id: 1,
//   name: 'System Administrator',
//   phone: '9999999999',
//   role: 'admin',
//   email: 'admin@auction.com'
// };

// // Generate JWT token
// const generateToken = (adminId) => {
//   return jwt.sign({ id: adminId, role: 'admin' }, process.env.JWT_SECRET || 'admin_secret_key', {
//     expiresIn: '24h',
//   });
// };

// // Send OTP for admin login
// exports.sendAdminOTP = async (req, res) => {
//   try {
//     const { phone } = req.body;

//     // Check if phone number matches admin phone
//     if (phone !== ADMIN_PHONE) {
//       return res.status(404).json({
//         success: false,
//         message: 'Admin not found'
//       });
//     }

//     // In a real application, you would send an OTP via SMS
//     // For this fixed implementation, we'll just return success
//     console.log(`Admin OTP for ${ADMIN_PHONE}: ${FIXED_OTP}`);
    
//     res.status(200).json({
//       success: true,
//       message: 'OTP sent successfully',
//       // In development, you might want to return the OTP
//       otp: FIXED_OTP
//     });
//   } catch (error) {
//     console.error('Send admin OTP error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to send OTP'
//     });
//   }
// };

// // Verify OTP and login admin
// exports.verifyAdminOTP = async (req, res) => {
//   try {
//     const { phone, otp } = req.body;

//     // Check if phone number matches admin phone
//     if (phone !== ADMIN_PHONE) {
//       return res.status(404).json({
//         success: false,
//         message: 'Admin not found'
//       });
//     }

//     // Verify OTP
//     if (otp !== FIXED_OTP) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid OTP'
//       });
//     }

//     // Generate token
//     const token = generateToken(ADMIN_DATA.id);

//     // Return success response with token
//     res.status(200).json({
//       success: true,
//       message: 'Admin login successful',
//       token,
//       admin: ADMIN_DATA
//     });
//   } catch (error) {
//     console.error('Verify admin OTP error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to verify OTP'
//     });
//   }
// };

// // Middleware to verify admin token
// exports.verifyAdminToken = async (req, res, next) => {
//   try {
//     const token = req.header('Authorization')?.replace('Bearer ', '');
    
//     if (!token) {
//       return res.status(401).json({
//         success: false,
//         message: 'Access denied. No token provided.'
//       });
//     }

//     const decoded = jwt.verify(token, process.env.JWT_SECRET || 'admin_secret_key');
    
//     // Check if the decoded token has admin role
//     if (decoded.role !== 'admin') {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied. Admin privileges required.'
//       });
//     }

//     req.admin = decoded;
//     next();
//   } catch (error) {
//     console.error('Token verification error:', error);
//     res.status(400).json({
//       success: false,
//       message: 'Invalid token'
//     });
//   }
// };