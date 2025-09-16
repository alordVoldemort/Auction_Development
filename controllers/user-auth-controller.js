const jwt = require('jsonwebtoken');
const db = require('../db');
const { sendOTP, verifyOTP } = require('../utils/otp');
require('dotenv').config();

exports.signup = async (req, res) => {
  try {
    const { company_name, phone_number, person_name, email, company_address, company_product_service } = req.body;

    // Validation rules
    if (!company_name || company_name.trim().length < 2) {
      return res.status(400).json({ success: false, message: "Company name is required (min 2 characters)" });
    }

    if (person_name && !/^[a-zA-Z\s]+$/.test(person_name)) {
      return res.status(400).json({ success: false, message: "Person name should only contain letters" });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Invalid email format" });
    }

    if (!company_product_service || company_product_service.trim().length < 2) {
      return res.status(400).json({ success: false, message: "Company product/service is required" });
    }

    if (company_address && company_address.length > 255) {
      return res.status(400).json({ success: false, message: "Company address must be less than 255 characters" });
    }

    // Check if phone already exists
    const [existingUser] = await db.query('SELECT * FROM users WHERE phone_number = ?', [phone_number]);
    if (existingUser.length > 0) {
      return res.status(400).json({ success: false, message: "User already exists with this phone number" });
    }

    // Insert into DB
    const [result] = await db.query(
      'INSERT INTO users (company_name, phone_number, person_name, email, company_address, company_product_service) VALUES (?, ?, ?, ?, ?, ?)',
      [company_name, phone_number, person_name, email, company_address, company_product_service]
    );

    const userId = result.insertId;

    // Generate JWT token
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRATION });

    res.status(201).json({ 
      success: true, 
      message: "Company registered successfully", 
      token, 
      userId,
      user: {
        id: userId,
        company_name,
        phone_number,
        person_name,
        email,
        company_address,
        company_product_service
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};


exports.sendLoginOTP = async (req, res) => {
  try {
    const { phone_number } = req.body;
    
    if (!phone_number) {
      return res.status(400).json({ success: false, message: "Phone number is required" });
    }

    // Check if user exists
    const [user] = await db.query('SELECT * FROM users WHERE phone_number = ?', [phone_number]);
    if (user.length === 0) {
      return res.status(400).json({ success: false, message: "User not found. Please sign up first." });
    }

    const sessionId = await sendOTP(phone_number);
    
    res.json({ 
      success: true, 
      message: "OTP sent successfully", 
      sessionId 
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to send OTP", 
      error: error.message 
    });
  }
};

exports.verifyLoginOTP = async (req, res) => {
  try {
    const { sessionId, otp, phone_number } = req.body;
    
    if (!sessionId || !otp || !phone_number) {
      return res.status(400).json({ 
        success: false, 
        message: "Session ID, OTP, and phone number are required" 
      });
    }

    const isValid = await verifyOTP(sessionId, otp);
    if (!isValid) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    const [user] = await db.query('SELECT * FROM users WHERE phone_number = ?', [phone_number]);
    if (user.length === 0) {
      return res.status(400).json({ success: false, message: "User not found" });
    }

    const token = jwt.sign(
      { userId: user[0].id }, 
      process.env.JWT_SECRET, 
      { expiresIn: process.env.JWT_EXPIRATION }
    );

    res.json({ 
      success: true, 
      message: "Login successful", 
      token, 
      userId: user[0].id,
      user: {
        id: user[0].id,
        company_name: user[0].company_name,
        phone_number: user[0].phone_number,
        person_name: user[0].person_name,
        email: user[0].email,
        company_address: user[0].company_address
      }
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message 
    });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const [user] = await db.query(
      'SELECT id, company_name, phone_number, person_name, email, company_address, company_product_service FROM users WHERE id = ?', 
      [userId]
    );
    
    if (user.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user: user[0] });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Edit Profile by ID - User can only edit their own profile
exports.editProfileByID = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { user_id } = req.params;
    const { company_name, person_name, email, company_address, company_product_service } = req.body;

    if (parseInt(user_id) !== parseInt(userId)) {
      return res.status(403).json({ 
        success: false, 
        message: "You can only edit your own profile" 
      });
    }

    if (!company_name || !person_name) {
      return res.status(400).json({ 
        success: false, 
        message: "Company name and person name are required" 
      });
    }

    const [userCheck] = await db.query('SELECT id FROM users WHERE id = ?', [user_id]);
    if (userCheck.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const [result] = await db.query(
      `UPDATE users 
       SET company_name = ?, person_name = ?, email = ?, company_address = ?, company_product_service = ?, updated_at = NOW()
       WHERE id = ?`,
      [company_name, person_name, email, company_address, company_product_service, user_id]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ success: false, message: "Failed to update profile" });
    }

    const [updatedUser] = await db.query(
      'SELECT id, company_name, phone_number, person_name, email, company_address, company_product_service FROM users WHERE id = ?',
      [user_id]
    );

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: updatedUser[0]
    });

  } catch (error) {
    console.error('Edit profile by ID error:', error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message 
    });
  }
};
