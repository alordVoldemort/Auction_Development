const Auction = require('../models/Auction');

// Update auction statuses every minute using setInterval
function startAuctionStatusUpdates() {
  console.log('🔄 Starting automatic auction status updates...');
  
  setInterval(async () => {
    console.log('🔄 Running automatic auction status update...');
    try {
      await Auction.updateAuctionStatuses();
      console.log('✅ Auction status update completed');
    } catch (error) {
      console.error('❌ Automatic status update failed:', error);
    }
  }, 60000); // 60 seconds = 60000 milliseconds

  // Also run immediately on startup
  setTimeout(async () => {
    console.log('🔄 Running initial auction status update...');
    try {
      await Auction.updateAuctionStatuses();
      console.log('✅ Initial status update completed');
    } catch (error) {
      console.error('❌ Initial status update failed:', error);
    }
  }, 2000); // Run after 2 seconds
}

module.exports = { startAuctionStatusUpdates };