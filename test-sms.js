require('dotenv').config();
const { sendSMS, checkBalance } = require('./utils/smsService');

async function testPromotionalSMS() {
  console.log('🧪 Testing Promotional SMS...\n');
  console.log('🔑 API Key:', process.env.TWO_FACTOR_API_KEY);

  // Check balance
  try {
    const balance = await checkBalance();
    if (balance.success) {
      console.log(`💰 SMS Balance: ${balance.balance}`);
    } else {
      console.log('⚠️ Could not check balance:', balance.error);
    }
  } catch (error) {
    console.log('❌ Balance check failed:', error.message);
  }

  // Test promotional SMS
  try {
    const message = 'Join "Steel Pipes Auction" on 31/12/2023 at 2:00 PM. Register now! - Zonictex IT Services';
    
    console.log('\n📨 Testing SMS sending...');
    const result = await sendSMS('+919860345330', message);
    
    console.log('🎉 Promotional SMS Test Successful!');
    console.log('📧 Status:', result.details.Details);
    return result;
    
  } catch (error) {
    console.log('❌ Promotional SMS Test Failed:', error.message);
    
    if (error.message.includes('Invalid API Key')) {
      console.log('\n🔑 Please use your PROMOTIONAL_API_KEY in .env file');
      console.log('💡 Current key:', process.env.TWO_FACTOR_API_KEY);
    }
    
    throw error;
  }
}

testPromotionalSMS();