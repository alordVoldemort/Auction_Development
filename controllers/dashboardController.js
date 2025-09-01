const db = require('../db');

exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get all dashboard data in parallel
    const [stats, upcomingAuctions, recentActivities] = await Promise.all([
      getDashboardStats(userId),
      getUpcomingAuctions(userId),
      getRecentActivity(userId)
    ]);

    res.json({
      success: true,
      dashboard: {
        welcome_message: "Welcome back! 👋 Here's what's happening with your auctions today.",
        stats: stats,
        upcoming_auctions: upcomingAuctions,
        recent_activities: recentActivities
      }
    });

  } catch (error) {
    console.error('❌ Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Helper function to get dashboard statistics - FIXED LIVE AUCTIONS QUERY
async function getDashboardStats(userId) {
  // Get all stats in parallel for better performance
  const [
    createdResult,
    activeResult,
    participatedResult,
    liveResult,
    bidsResult,
    winningBidsResult,
    avgBidResult
  ] = await Promise.all([
    // Total created auctions
    db.query('SELECT COUNT(*) as count FROM auctions WHERE created_by = ?', [userId]),
    
    // Active auctions (live + upcoming)
    db.query('SELECT COUNT(*) as count FROM auctions WHERE created_by = ? AND status IN ("live", "upcoming")', [userId]),
    
    // Participated auctions count
    db.query('SELECT COUNT(DISTINCT auction_id) as count FROM bids WHERE user_id = ?', [userId]),
    
    // Live auctions count (ALL live auctions, not filtered by user) - FIXED THIS QUERY
    db.query('SELECT COUNT(*) as count FROM auctions WHERE status = "live"', []), // Removed userId parameter
    
    // Total bids placed by user
    db.query('SELECT COUNT(*) as count FROM bids WHERE user_id = ?', [userId]),
    
    // Winning bids count
    db.query('SELECT COUNT(*) as count FROM bids WHERE user_id = ? AND is_winning = TRUE', [userId]),
    
    // Average response time (placeholder - you can implement real tracking)
    db.query('SELECT 2.3 as avg_response')
  ]);

  return {
    total_created: createdResult[0][0].count,
    active_auctions: activeResult[0][0].count,
    participated_auctions: participatedResult[0][0].count,
    live_auctions: liveResult[0][0].count, // This will now show ALL live auctions
    total_bids: bidsResult[0][0].count,
    winning_bids: winningBidsResult[0][0].count,
    avg_response_time: `${avgBidResult[0][0].avg_response}s`
  };
}

// Helper function to get upcoming/live auctions - DYNAMIC DATA
async function getUpcomingAuctions(userId) {
  const [auctions] = await db.query(`
    SELECT 
      a.id,
      a.title,
      a.status,
      a.auction_date,
      a.start_time,
      a.duration,
      a.current_price,
      a.currency,
      COUNT(DISTINCT ap.id) as participant_count,
      COUNT(DISTINCT b.id) as bid_count,
      CONCAT('AUC', LPAD(a.id, 3, '0')) as auction_no,
      u.company_name as creator_company
    FROM auctions a
    LEFT JOIN auction_participants ap ON a.id = ap.auction_id
    LEFT JOIN bids b ON a.id = b.auction_id
    LEFT JOIN users u ON a.created_by = u.id
    WHERE a.status IN ('live', 'upcoming')
    AND (a.created_by = ? OR EXISTS (
      SELECT 1 FROM bids WHERE auction_id = a.id AND user_id = ?
    ))
    GROUP BY a.id
    ORDER BY 
      CASE WHEN a.status = 'live' THEN 0 ELSE 1 END,
      a.auction_date, 
      a.start_time
    LIMIT 5
  `, [userId, userId]);

  return auctions.map(auction => ({
    id: auction.id,
    title: auction.title,
    status: formatStatus(auction.status),
    auction_date: formatDate(auction.auction_date),
    start_time: formatTime(auction.start_time),
    duration: formatDuration(auction.duration),
    current_price: `${auction.currency} ${auction.current_price}`,
    participant_count: auction.participant_count,
    bid_count: auction.bid_count,
    auction_no: auction.auction_no,
    creator: auction.creator_company
  }));
}

// Helper function to get recent activity - DYNAMIC DATA
async function getRecentActivity(userId) {
  // Get recent auction creations with actual timestamps
  const [createdAuctions] = await db.query(`
    SELECT 
      'created' as type, 
      title, 
      created_at as timestamp,
      id as auction_id
    FROM auctions 
    WHERE created_by = ? 
    ORDER BY created_at DESC 
    LIMIT 8
  `, [userId]);

  // Get recent auction participations (bids) with actual data
  const [joinedAuctions] = await db.query(`
    SELECT 
      'joined' as type, 
      a.title, 
      b.bid_time as timestamp,
      b.amount,
      a.id as auction_id
    FROM bids b
    JOIN auctions a ON b.auction_id = a.id
    WHERE b.user_id = ? 
    ORDER BY b.bid_time DESC 
    LIMIT 8
  `, [userId]);

  // Get recent wins
  const [wonAuctions] = await db.query(`
    SELECT 
      'won' as type, 
      a.title, 
      b.bid_time as timestamp,
      b.amount,
      a.id as auction_id
    FROM bids b
    JOIN auctions a ON b.auction_id = a.id
    WHERE b.user_id = ? AND b.is_winning = TRUE
    ORDER BY b.bid_time DESC 
    LIMIT 5
  `, [userId]);

  // Combine and format activities
  let activities = [
    ...createdAuctions.map(activity => ({
      type: activity.type,
      message: `Created auction "${activity.title}"`,
      timestamp: formatTimestamp(activity.timestamp),
      icon: "✨",
      auction_id: activity.auction_id,
      raw_timestamp: activity.timestamp
    })),
    ...joinedAuctions.map(activity => ({
      type: activity.type,
      message: `Placed bid of ${activity.amount} on "${activity.title}"`,
      timestamp: formatTimestamp(activity.timestamp),
      icon: "💰",
      auction_id: activity.auction_id,
      raw_timestamp: activity.timestamp
    })),
    ...wonAuctions.map(activity => ({
      type: activity.type,
      message: `Won auction "${activity.title}" with ${activity.amount}`,
      timestamp: formatTimestamp(activity.timestamp),
      icon: "🏆",
      auction_id: activity.auction_id,
      raw_timestamp: activity.timestamp
    }))
  ];

  // Sort by timestamp and remove duplicates
  activities = activities
    .sort((a, b) => new Date(b.raw_timestamp) - new Date(a.raw_timestamp))
    .filter((activity, index, self) => 
      index === self.findIndex(a => 
        a.message === activity.message && 
        Math.abs(new Date(a.raw_timestamp) - new Date(activity.raw_timestamp)) < 30000 // 30 second threshold
      )
    )
    .slice(0, 12);

  // Remove raw_timestamp before returning
  return activities.map(({ raw_timestamp, ...activity }) => activity);
}

// Helper function to format duration correctly
function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
  }
}

// Helper function to format status consistently
function formatStatus(status) {
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

// Helper function to format date
function formatDate(dateString) {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (error) {
    return dateString;
  }
}

// Helper function to format time
function formatTime(timeString) {
  try {
    const [hours, minutes, seconds] = timeString.split(':');
    return `${hours}:${minutes}`;
  } catch (error) {
    return timeString;
  }
}

// Improved helper function to format timestamp
function formatTimestamp(timestamp) {
  try {
    const now = new Date();
    const activityTime = new Date(timestamp);
    const diffMs = now - activityTime;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    // For older activities, show the actual date
    return activityTime.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (error) {
    return "Recently";
  }
}