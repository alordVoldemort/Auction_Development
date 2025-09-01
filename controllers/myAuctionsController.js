const Auction = require('../models/Auction');
const Bid = require('../models/Bid');
const db = require('../db');

// exports.getAuctionStats = async (req, res) => {
//   try {
//     const userId = req.user.userId;
    
//     // Get counts for different auction statuses
//     const [createdStats] = await db.query(
//       `SELECT status, COUNT(*) as count 
//        FROM auctions 
//        WHERE created_by = ? 
//        GROUP BY status`,
//       [userId]
//     );
    
//     const [participatedStats] = await db.query(
//       `SELECT a.status, COUNT(DISTINCT a.id) as count 
//        FROM auctions a 
//        JOIN bids b ON a.id = b.auction_id 
//        WHERE b.user_id = ? 
//        GROUP BY a.status`,
//       [userId]
//     );
    
//     // Format the response
//     const stats = {
//       created: {
//         live: 0,
//         upcoming: 0,
//         completed: 0,
//         total: 0
//       },
//       participated: {
//         live: 0,
//         upcoming: 0,
//         completed: 0,
//         total: 0
//       }
//     };
    
//     // Populate created stats
//     createdStats.forEach(stat => {
//       stats.created[stat.status] = stat.count;
//       stats.created.total += stat.count;
//     });
    
//     // Populate participated stats
//     participatedStats.forEach(stat => {
//       stats.participated[stat.status] = stat.count;
//       stats.participated.total += stat.count;
//     });
    
//     res.json({
//       success: true,
//       stats
//     });
    
//   } catch (error) {
//     console.error('❌ Get auction stats error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// };

exports.getAuctionTimers = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { type = 'all' } = req.query;
    
    let query = `
      SELECT a.id, a.auction_date, a.start_time, a.duration, a.status
      FROM auctions a
      WHERE (a.created_by = ? OR EXISTS(SELECT 1 FROM bids WHERE auction_id = a.id AND user_id = ?))
      AND (a.status IN ('live', 'upcoming') OR a.status IS NULL)
    `;
    
    const params = [userId, userId];
    
    if (type === 'created') {
      query += ' AND a.created_by = ?';
      params.push(userId);
    } else if (type === 'participated') {
      query += ' AND EXISTS(SELECT 1 FROM bids WHERE auction_id = a.id AND user_id = ?)';
      params.push(userId);
    }
    
    const [auctions] = await db.query(query, params);
    
    // Calculate time remaining for each auction
    const now = new Date();
    const timers = auctions.map(auction => {
      try {
        // If status is null, determine it based on current time
        let effectiveStatus = auction.status;
        if (effectiveStatus === null) {
          const auctionDate = new Date(auction.auction_date);
          const timeParts = auction.start_time.split(':');
          const auctionDateTime = new Date(auctionDate);
          auctionDateTime.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), parseInt(timeParts[2] || 0));
          
          effectiveStatus = auctionDateTime > now ? 'upcoming' : 'live';
        }
        
        // Parse the auction date and time
        const auctionDate = new Date(auction.auction_date);
        const timeParts = auction.start_time.split(':');
        const hours = parseInt(timeParts[0]) || 0;
        const minutes = parseInt(timeParts[1]) || 0;
        const seconds = parseInt(timeParts[2]) || 0;
        
        // Create the full auction start datetime
        const auctionDateTime = new Date(auctionDate);
        auctionDateTime.setHours(hours, minutes, seconds, 0);
        
        // Calculate end time
        const endTime = new Date(auctionDateTime.getTime() + (auction.duration * 1000));
        
        let timeRemaining = 0;
        let timerType = '';
        
        if (effectiveStatus === 'live') {
          timeRemaining = endTime - now;
          timerType = 'countdown';
        } else if (effectiveStatus === 'upcoming') {
          timeRemaining = auctionDateTime - now;
          timerType = 'countup';
        }
        
        // Ensure non-negative time
        timeRemaining = Math.max(0, timeRemaining);
        
        return {
          auction_id: auction.id,
          time_remaining: timeRemaining,
          timer_type: timerType,
          status: effectiveStatus
        };
        
      } catch (error) {
        console.error('Error processing auction timer:', auction.id, error);
        return {
          auction_id: auction.id,
          time_remaining: 0,
          timer_type: 'error',
          status: auction.status
        };
      }
    });
    
    res.json({
      success: true,
      timers
    });
    
  } catch (error) {
    console.error('❌ Get auction timers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};