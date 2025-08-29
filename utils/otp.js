const axios = require('axios');
const db = require('../db');

const TWO_FACTOR_API_KEY = process.env.TWO_FACTOR_API_KEY;

exports.sendOTP = async (phone_number) => {
  try {
    const cleanedPhone = phone_number.replace(/\D/g, '');
    
    // Send OTP via 2factor.in API
    const response = await axios.get(
      `https://2factor.in/API/V1/${TWO_FACTOR_API_KEY}/SMS/${cleanedPhone}/AUTOGEN/OTP1`
    );
    
    const data = response.data;
    
    if (data.Status !== 'Success') {
      throw new Error('Failed to send OTP via 2factor.in');
    }
    
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    
    await db.query(
      'INSERT INTO otp_verifications (phone_number, otp, session_id, expires_at) VALUES (?, ?, ?, ?)',
      [phone_number, 'PENDING', data.Details, expiresAt]
    );
    
    return data.Details; 
    
  } catch (error) {
    console.error('Error sending OTP:', error.message);
    throw error;
  }
};

exports.verifyOTP = async (sessionId, otp) => {
  try {
    // Verify OTP via 2factor.in API
    const response = await axios.get(
      `https://2factor.in/API/V1/${TWO_FACTOR_API_KEY}/SMS/VERIFY/${sessionId}/${otp}`
    );
    
    const data = response.data;
    
    if (data.Status !== 'Success') {
      return false;
    }
    
    await db.query(
      'UPDATE otp_verifications SET verified = TRUE, otp = ? WHERE session_id = ?',
      [otp, sessionId]
    );
    
    return true;
  } catch (error) {
    console.error('Error verifying OTP:', error.message);
    return false;
  }
};