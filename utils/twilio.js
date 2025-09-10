// config/twilio.js
const twilio = require('twilio');
require('dotenv').config();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const sendTwilioSMS = async (to, body) => {
  try {
    const message = await client.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to
    });
    console.log("✅ Twilio SMS sent:", message.sid);
    return { success: true, sid: message.sid };
  } catch (error) {
    console.error("❌ Twilio SMS error:", error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { sendTwilioSMS };