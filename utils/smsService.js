const axios = require('axios');

// Use the correct environment variable for promotional SMS
const PROMOTIONAL_API_KEY = process.env.PROMOTIONAL_API_KEY;

/**
 * Send SMS using 2factor.in PROMOTIONAL endpoint
 */
exports.sendSMS = async (phone_number, message) => {
  try {
    // Validate API key
    if (!PROMOTIONAL_API_KEY) {
      throw new Error('Promotional API Key not configured');
    }

    console.log(`🔑 Using Promotional API Key: ${PROMOTIONAL_API_KEY.substring(0, 8)}...`);

    // Clean and validate phone number
    const cleanedPhone = phone_number.replace(/\D/g, '');
    
    let formattedPhone = cleanedPhone;
    if (formattedPhone.startsWith('0')) {
      formattedPhone = formattedPhone.substring(1);
    }
    if (!formattedPhone.startsWith('91') && formattedPhone.length === 10) {
      formattedPhone = '91' + formattedPhone;
    }
    
    console.log(`📱 Sending SMS to: ${formattedPhone}`);
    console.log(`📝 Message: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
    
    // ✅ USE PROMOTIONAL ENDPOINT
    const apiUrl = `https://2factor.in/API/V1/${PROMOTIONAL_API_KEY}/ADDON_SERVICES/SEND/PSMS`;
    
    const params = new URLSearchParams();
    params.append('From', 'ZONIXT');
    params.append('To', formattedPhone);
    params.append('Msg', message);

    console.log('🌐 Calling Promotional SMS API...');
    
    const response = await axios.post(apiUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    });
    
    const data = response.data;
    
    if (data.Status !== 'Success') {
      throw new Error(`API Error: ${data.Details || JSON.stringify(data)}`);
    }
    
    console.log('✅ Promotional SMS sent successfully!');
    console.log('📊 Response:', data.Details);
    
    return {
      success: true,
      status: 'sent',
      details: data
    };
    
  } catch (error) {
    console.error('❌ Error sending promotional SMS:', error.message);
    
    if (error.response) {
      console.error('📊 API Response:', error.response.status, error.response.data);
      throw new Error(`SMS failed: ${error.response.data.Details || error.response.statusText}`);
    }
    
    throw new Error(`SMS failed: ${error.message}`);
  }
};

/**
 * Check Promotional SMS balance
 */
exports.checkBalance = async () => {
  try {
    const apiUrl = `https://2factor.in/API/V1/${PROMOTIONAL_API_KEY}/BALANCE/PSMS`;
    
    const response = await axios.get(apiUrl, { timeout: 5000 });
    const data = response.data;
    
    return {
      success: data.Status === 'Success',
      balance: data.Details,
      details: data
    };
    
  } catch (error) {
    console.error('Balance check error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
};