/* --------------  IST locking  -------------- */
const { formatInTimeZone, toZonedTime } = require('date-fns-tz');
const TZ   = 'Asia/Kolkata';
const istYMD = (dt) => formatInTimeZone(dt, TZ, 'yyyy-MM-dd');
/* ------------------------------------------- */

const axios   = require('axios');
const Auction = require('../models/Auction');
const AuctionParticipant = require('../models/AuctionParticipant');
const AuctionDocument = require('../models/AuctionDocument');
const Bid   = require('../models/Bid');
// const { sendSMS } = require('../utils/smsService');
const { sendTwilioSMS } = require('../utils/twilio');
const db    = require('../db');

// Enhanced automatic status update system
let statusUpdateInterval;

// ------------------------------------------------------------------
// WhatsApp helper
// ------------------------------------------------------------------
async function sendWhatsAppMessage(phone, templateName = 'auction_invitations') {
  const token = process.env.WHATSAPP_TOKEN;
  const url = 'https://graph.facebook.com/v22.0/712866835253680/messages';

  const body = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: { name: templateName, language: { code: "en_US" } }
  };

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {
    const { data } = await axios.post(url, body, { headers });
    console.log(`✅ WhatsApp sent to ${phone}:`, data);
    return { success: true, data };
  } catch (err) {
    console.error(`❌ WhatsApp failed for ${phone}:`, err.response?.data || err.message);
    return { success: false, error: err.response?.data || err.message };
  }
}

// ------------------------------------------------------------------
// Time format helpers
// ------------------------------------------------------------------
function formatTimeToAMPM(timeValue) {
  if (!timeValue) return '';

  let hours, minutes;

  if (typeof timeValue === 'string') {
    // If it's a string like "2025-09-09 17:30:00" or "17:30:00"
    let timePart = timeValue.includes(' ') ? timeValue.split(' ')[1] : timeValue;
    [hours, minutes] = timePart.split(':');
  } else if (timeValue instanceof Date) {
    hours = timeValue.getHours();
    minutes = timeValue.getMinutes();
  } else {
    return '';
  }

  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const fmtH = hour % 12 || 12;

  return `${fmtH}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

function calculateEndTime(startTime, duration) {
  if (!startTime || !duration) return '';

  let start;

  if (typeof startTime === 'string') {
    const [h, m] = startTime.split(':');
    start = new Date();
    start.setHours(parseInt(h, 10), parseInt(m, 10), 0);
  } else if (startTime instanceof Date) {
    start = new Date(startTime);
  } else {
    return '';
  }

  const end = new Date(start.getTime() + duration * 60 * 1000); // duration is in minutes
  const eh = end.getHours();
  const em = end.getMinutes();
  const ampm = eh >= 12 ? 'PM' : 'AM';

  return `${(eh % 12 || 12)}:${em.toString().padStart(2, '0')} ${ampm}`;
}


// ------------------------------------------------------------------
// Debug helper
// ------------------------------------------------------------------
async function debugAuctionStatus(auctionId) {
  try {
    const [rows] = await db.query('SELECT * FROM auctions WHERE id = ?', [auctionId]);
    if (!rows[0]) return console.log(`❌ Auction ${auctionId} not found`);
    const a = rows[0];
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    console.log(`\n🔍 DEBUG: Auction ${auctionId} - "${a.title}"`);
    console.log(`Current status: ${a.status}`);
    console.log(`Auction date: ${a.auction_date}`);
    console.log(`Start time: ${a.start_time}`);
    console.log(`Duration: ${a.duration}s | End time: ${a.end_time}`);
    console.log(`Server time: ${now}`);

    const [calc] = await db.query(`
      SELECT TIMESTAMP(auction_date,start_time) as startdt,
             TIMESTAMP(auction_date,start_time) + INTERVAL duration SECOND as enddt,
             TIMESTAMP(auction_date,start_time) <= ? as shouldLive,
             TIMESTAMP(auction_date,start_time) + INTERVAL duration SECOND <= ? as shouldDone
      FROM auctions WHERE id = ?`, [now, now, auctionId]);
    console.log(`Calc start: ${calc[0].startdt} | Calc end: ${calc[0].enddt}`);
    console.log(`Should live: ${calc[0].shouldLive} | Should completed: ${calc[0].shouldDone}`);
  } catch (e) { console.error('Debug error:', e); }
}
// ------------------------------------------------------------------
// Status updater  (IST comparisons)
// ------------------------------------------------------------------
async function updateAuctionStatuses() {
  let conn;
  try {
    console.log('🔄 Auto-updating auction statuses...');
    const nowIST = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    console.log('Current IST now:', nowIST);

    conn = await db.getConnection(); await conn.beginTransaction();

    /* 1. mark completed */
const [toCompleted] = await conn.query(`
  UPDATE auctions
  SET status = 'completed',
      end_time = DATE_FORMAT(CONVERT_TZ(CONCAT(auction_date,' ',start_time), '+00:00','+05:30') + INTERVAL duration MINUTE, '%H:%i:%s')
  WHERE (status = 'live' OR status = 'upcoming')
    AND CONVERT_TZ(CONCAT(auction_date,' ',start_time), '+00:00','+05:30') + INTERVAL duration MINUTE <= CONVERT_TZ(NOW(),'+00:00','+05:30')
`, [nowIST]);

/* 2. upcoming -> live */
const [upcomingToLive] = await conn.query(`
  UPDATE auctions
  SET status = 'live',
      end_time = DATE_FORMAT(CONVERT_TZ(CONCAT(auction_date,' ',start_time), '+00:00','+05:30') + INTERVAL duration MINUTE, '%H:%i:%s')
  WHERE status = 'upcoming'
    AND CONVERT_TZ(CONCAT(auction_date,' ',start_time), '+00:00','+05:30') <= CONVERT_TZ(NOW(),'+00:00','+05:30')
    AND CONVERT_TZ(CONCAT(auction_date,' ',start_time), '+00:00','+05:30') + INTERVAL duration MINUTE > CONVERT_TZ(NOW(),'+00:00','+05:30')
`, [nowIST, nowIST]);

    await conn.commit();
    console.log(`✅ Status update done → completed:${toCompleted.affectedRows}  live:${upcomingToLive.affectedRows}`);
    return { toCompleted: toCompleted.affectedRows, upcomingToLive: upcomingToLive.affectedRows };
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('❌ Status update error:', err); throw err;
  } finally { if (conn) conn.release(); }
}

// ------------------------------------------------------------------
// Cron & graceful shutdown
// ------------------------------------------------------------------
function startAutomaticStatusUpdates() {
  if (statusUpdateInterval) clearInterval(statusUpdateInterval);
  updateAuctionStatuses().then(r => console.log('✅ Initial status update:', r)).catch(console.error);
  statusUpdateInterval = setInterval(() => updateAuctionStatuses()
    .then(r => { if (r.toCompleted || r.upcomingToLive) console.log('🔄 Periodic:', r); })
    .catch(console.error), 30000);
  console.log('✅ Auto status updates every 30 s (IST)');
}
startAutomaticStatusUpdates();

process.on('SIGINT', () => {
  if (statusUpdateInterval) { clearInterval(statusUpdateInterval); console.log('❌ Auto updates stopped'); }
  process.exit(0);
});

// ------------------------------------------------------------------
// Manual trigger endpoint
// ------------------------------------------------------------------
exports.autoUpdateAuctionStatus = async (req, res) => {
  try {
    const { debug_auction_id } = req.query;
    if (debug_auction_id) await debugAuctionStatus(debug_auction_id);
    const results = await updateAuctionStatuses();
    const [rows] = await db.query('SELECT status, COUNT(*) as c FROM auctions GROUP BY status');
    const counts = rows.reduce((a, { status, c }) => { a[status] = c; return a; }, {});
    res.json({ success: true, message: 'Manual update done', results, statusCounts: counts, timestamp: new Date() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Update failed', error: e.message });
  }
};

// ------------------------------------------------------------------
// Create auction  (IST calendar day locked)
// ------------------------------------------------------------------
exports.createAuction = async (req, res) => {
  try {
    const {
      title, description, auction_date, start_time, duration, currency,
      decremental_value, pre_bid_allowed = true, participants, send_invitations = true
    } = req.body;

    // 1. basic required fields
    if (!title || !auction_date || !start_time || !duration || !decremental_value)
      return res.status(400).json({ success: false, message: 'Required fields missing' });

    // 2. block illegal 24-hr times before they hit MySQL
    const timeRE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
    if (!timeRE.test(start_time))
      return res.status(400).json({ success: false, message: 'start_time must be valid HH:MM:SS (00-23)' });

    const created_by = req.user.userId;

    // 3. use the date exactly as sent from frontend (already IST)
    const finalAuctionDate = auction_date;

    // 4. create auction
    const auctionId = await Auction.create({
      title,
      description,
      auction_date: finalAuctionDate,
      start_time,
      duration: parseInt(duration, 10),      // minutes
      currency: currency || 'INR',
      decremental_value: parseFloat(decremental_value),
      current_price: parseFloat(decremental_value),
      pre_bid_allowed: pre_bid_allowed === 'true' || pre_bid_allowed === true,
      created_by
    });

    // 5. run status updater once so new row is set to 'upcoming'
    await updateAuctionStatuses();

    /* ---------------  PARTICIPANT & SMS LOGIC  --------------- */
    let participantList = [];
    let smsCount = 0;
    const failures = [];

    if (participants) {
      participantList = [
        ...new Set(
          Array.isArray(participants) ? participants : [participants]
        )
      ].filter(Boolean);

      if (participantList.length) {
        await AuctionParticipant.addMultiple(
          auctionId,
          participantList.map(p => ({ user_id: null, phone_number: p }))
        );

        if (send_invitations === 'true' || send_invitations === true) {
          const auction = await Auction.findById(auctionId);
          const auctionDate = new Date(auction.auction_date).toLocaleDateString('en-IN');
          const msg = `Join "${auction.title}" auction on ${auctionDate} at ${auction.start_time}. Website: https://soft-macaron-8cac07.netlify.app/register `;

          for (const p of participantList) {
            try { await sendTwilioSMS(p, msg); smsCount++; }
            catch (e) { failures.push({ participant: p, type: 'SMS', error: e.message }); }
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
    }

    /* ---------------  DOCUMENT UPLOADS  --------------- */
    let uploadedDocs = [];
    if (req.files?.length) {
      for (const file of req.files) {
        const docId = await AuctionDocument.add({
          auction_id: auctionId,
          file_name: file.originalname,
          file_path: file.path,
          file_type: file.mimetype,
          file_size: file.size
        });
        const fileUrl = `${req.protocol}://${req.get('host')}/${file.path.replace(/\\/g, '/')}`;
        uploadedDocs.push({ id: docId, file_name: file.originalname, file_url: fileUrl, file_type: file.mimetype });
      }
    }

    const auction = await Auction.findById(auctionId);

    return res.status(201).json({
      success: true,
      message: `Auction created with ${participantList.length} participant(s)${smsCount ? `, ${smsCount} SMS` : ''}`,
      auction: {
        ...auction,
        formatted_start_time: formatTimeToAMPM(auction.start_time),
        formatted_end_time: calculateEndTime(auction.start_time, auction.duration)
      },
      invitationResults: { totalParticipants: participantList.length, successfulSMS: smsCount },
      documents: uploadedDocs
    });
  } catch (e) {
    console.error('❌ Create auction:', e);
    return res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

exports.getUserAuctions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status } = req.query;

    const auctions = await Auction.findByUser(userId, status);

    res.json({
      success: true,
      auctions,
      count: auctions.length
    });

  } catch (error) {
    console.error('❌ Get user auctions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.getAuctionDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Auction ID is required'
      });
    }

    // Get auction details
    const auction = await Auction.findById(id);
    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // Check if user has access to this auction
    const isCreator = auction.created_by === userId;
    const userPhone = req.user.phone_number || '';
    const isParticipant = await AuctionParticipant.isParticipant(id, userPhone);
    const hasBid = await Bid.hasUserBid(id, userId);
    
    // If user is not creator, not participant, and hasn't bid, restrict access
    if (!isCreator && !isParticipant && !hasBid && !auction.open_to_all) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this auction'
      });
    }

    // Get additional auction data
    const participants = await AuctionParticipant.findByAuction(id);
    const bids = await Bid.findByAuction(id);
    const documents = await AuctionDocument.findByAuction(id);
    const winner = await Bid.findWinningBid(id);
    const creator = await getUserById(auction.created_by);

    // Calculate time information
    const now = new Date();
    const auctionDateTime = new Date(`${auction.auction_date}T${auction.start_time}`);
    
    // Safely handle end_time calculation
    let endTime;
    if (auction.end_time) {
      // If end_time is a datetime string, extract just the time part
      if (typeof auction.end_time === 'string' && auction.end_time.includes(' ')) {
        const [datePart, timePart] = auction.end_time.split(' ');
        endTime = new Date(`${auction.auction_date}T${timePart}`);
      } else {
        endTime = new Date(`${auction.auction_date}T${auction.end_time}`);
      }
    } else if (auction.start_time && auction.duration) {
      endTime = new Date(auctionDateTime.getTime() + auction.duration * 60 * 1000);
    } else {
      endTime = null;
    }
    
    let timeStatus = auction.status;
    let timeValue = '';
    let timeRemaining = 0;

    if (auction.status === 'live' && endTime) {
      timeRemaining = endTime - now;
      if (timeRemaining > 0) {
        const hours = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
        timeStatus = 'Live';
        timeValue = `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
      } else {
        timeStatus = 'Ended';
        timeValue = '';
      }
    } else if (auction.status === 'upcoming') {
      timeRemaining = auctionDateTime - now;
      if (timeRemaining > 0) {
        const days = Math.floor(timeRemaining / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
        timeStatus = 'Starts in';
        timeValue = `${days}d ${hours}h ${minutes}m`;
      } else {
        timeStatus = 'Starting soon';
        timeValue = '';
      }
    }

    // Safe time formatting functions - FIXED VERSION
    const safeFormatTimeToAMPM = (timeValue) => {
      if (!timeValue) return 'N/A';
      
      try {
        let timeString;
        
        // Handle both time strings and datetime objects/strings
        if (typeof timeValue === 'string') {
          if (timeValue.includes('T') || timeValue.includes(' ')) {
            // It's a datetime string - extract time part
            const datetime = new Date(timeValue);
            if (isNaN(datetime.getTime())) {
              return 'N/A';
            }
            timeString = datetime.toTimeString().split(' ')[0]; // Gets "HH:MM:SS"
          } else {
            // It's already a time string (HH:MM:SS)
            timeString = timeValue;
          }
        } else if (timeValue instanceof Date) {
          // It's a Date object
          timeString = timeValue.toTimeString().split(' ')[0];
        } else {
          return 'N/A';
        }
        
        const [hours, minutes] = timeString.split(':');
        let hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12;
        hour = hour ? hour : 12; // the hour '0' should be '12'
        return `${hour}:${minutes} ${ampm}`;
      } catch (error) {
        console.error('Error formatting time:', error);
        return 'N/A';
      }
    };
    
    const safeCalculateEndTime = (startTime, duration) => {
      if (!startTime || !duration) return 'N/A';
      
      try {
        const [hours, minutes] = startTime.split(':');
        const startDate = new Date();
        startDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0);
        
        const endDate = new Date(startDate.getTime() + duration * 60 * 1000); // duration in minutes
        const endHours = endDate.getHours();
        const endMinutes = endDate.getMinutes();
        const ampm = endHours >= 12 ? 'PM' : 'AM';
        const formattedHour = endHours % 12 || 12;
        
        return `${formattedHour}:${endMinutes.toString().padStart(2, '0')} ${ampm}`;
      } catch (error) {
        console.error('Error calculating end time:', error);
        return 'N/A';
      }
    };

    // Format response with safe time formatting
    const formattedAuction = {
      ...auction,
      auction_no: `AUC${auction.id.toString().padStart(3, '0')}`,
      formatted_start_time: safeFormatTimeToAMPM(auction.start_time),
      formatted_end_time: auction.end_time ? 
        safeFormatTimeToAMPM(auction.end_time) : 
        safeCalculateEndTime(auction.start_time, auction.duration),
      time_remaining: timeRemaining,
      is_creator: isCreator,
      has_joined: isParticipant,
      has_bid: hasBid,
      creator_info: creator ? {
        company_name: creator.company_name,
        person_name: creator.person_name,
        phone: creator.phone_number   
      } : null,
      winner_info: winner ? {
        user_id: winner.user_id,
        person_name: winner.person_name,
        company_name: winner.company_name,
        amount: winner.amount
      } : null,
      participants: participants.map(p => ({
        id: p.id,
        user_id: p.user_id,
        phone_number: p.phone_number,
        status: p.status,
        invited_at: p.invited_at,
        joined_at: p.joined_at,
        person_name: p.person_name,
        company_name: p.company_name
      })),
      bids: bids.map(b => ({
        id: b.id,
        user_id: b.user_id,
        amount: b.amount,
        bid_time: b.bid_time,
        is_winning: b.is_winning,
        person_name: b.person_name,
        company_name: b.company_name
      })),
      documents: documents.map(d => ({
        id: d.id,
        file_name: d.file_name,
        file_url: `${req.protocol}://${req.get('host')}/${d.file_path.replace(/\\/g, '/')}`,
        file_type: d.file_type,
        uploaded_at: d.uploaded_at
      })),
      statistics: {
        total_participants: participants.length,
        total_bids: bids.length,
        active_participants: participants.filter(p => p.status === 'joined').length,
        highest_bid: bids.length > 0 ? Math.min(...bids.map(b => parseFloat(b.amount || 0))) : parseFloat(auction.current_price || 0),
        lowest_bid: bids.length > 0 ? Math.max(...bids.map(b => parseFloat(b.amount || 0))) : parseFloat(auction.current_price || 0)
      }
    };

    res.json({
      success: true,
      auction: formattedAuction
    });

  } catch (error) {
    console.error('❌ Get auction details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Helper function to get user by ID
async function getUserById(userId) {
  try {
    const [users] = await db.query(
      'SELECT id, company_name, person_name, phone_number FROM users WHERE id = ?',
      [userId]
    );
    return users[0] || null;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

exports.getLiveAuctions = async (req, res) => {
  try {
    // Update statuses before fetching
    await updateAuctionStatuses();
    
    const auctions = await Auction.findLive();

    res.json({
      success: true,
      auctions,
      count: auctions.length
    });

  } catch (error) {
    console.error('❌ Get live auctions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.placeBid = async (req, res) => {
  try {
    let { auction_id, amount } = req.body;
    const user_id = req.user.userId;

    if (!auction_id || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Auction ID and bid amount are required'
      });
    }

    // Update statuses before processing bid
    await updateAuctionStatuses();
    
    const auctionId = parseInt(auction_id, 10);
    if (isNaN(auctionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid auction ID'
      });
    }

    const auction = await Auction.findById(auctionId);
    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // ✅ ALLOW bids for both upcoming AND live auctions
    if (auction.status.toLowerCase() !== 'live' && auction.status.toLowerCase() !== 'upcoming') {
      return res.status(400).json({
        success: false,
        message: 'Bids can only be placed on upcoming or live auctions'
      });
    }

    const parsePrice = (val) => {
      if (!val) return 0;
      return parseFloat(val.toString().replace(/[^\d.-]/g, '')) || 0;
    };

    const currentPrice = parsePrice(auction.current_price);
    const decrementalValue = parsePrice(auction.decremental_value);

    const bidAmount = parseFloat(amount);
    if (isNaN(bidAmount) || bidAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bid amount'
      });
    }

    // Check auction type (decremental)
    if (decrementalValue > 0 && bidAmount >= currentPrice) {
      return res.status(400).json({
        success: false,
        message: `Bid must be lower than current price (${currentPrice})`
      });
    }

    // Save bid
    const bidId = await Bid.create({
      auction_id: auctionId,
      user_id,
      amount: bidAmount
    });

    // Update auction current price
    await Auction.updateCurrentPrice(auctionId, bidAmount);
    
    // Set as winning bid only for live auctions
    if (auction.status.toLowerCase() === 'live') {
      await Bid.setWinningBid(bidId);
    }

    const updatedAuction = await Auction.findById(auctionId);
    const bids = await Bid.findByAuction(auctionId);

    res.json({
      success: true,
      message: 'Bid placed successfully',
      bid: {
        id: bidId,
        auction_id: auctionId,
        user_id,
        amount: bidAmount,
        bid_time: new Date(),
        status: auction.status // Include auction status in response
      },
      auction: updatedAuction,
      bids
    });

  } catch (error) {
    console.error('❌ Place bid error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.closeAuction = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const auction = await Auction.findById(id);
    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // ✅ TEMPORARY: Remove creator check for testing
    // if (auction.created_by !== userId) {
    //   return res.status(403).json({
    //     success: false,
    //     message: 'Only auction creator can close the auction'
    //   });
    // }

    // Find winning bid
    const winningBid = await Bid.findWinningBid(id);
    const winnerId = winningBid ? winningBid.user_id : null;

    // Update auction status to completed
    await Auction.updateStatus(id, 'completed', winnerId);
    
    // Update end time to current time
    const currentTime = new Date().toTimeString().split(' ')[0];
    await db.query(
      'UPDATE auctions SET end_time = ? WHERE id = ?',
      [currentTime, id]
    );

    const updatedAuction = await Auction.findById(id);

    res.json({
      success: true,
      message: 'Auction closed successfully',
      auction: updatedAuction,
      winner: winningBid
    });

  } catch (error) {
    console.error('❌ Close auction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.extendAuctionTime = async (req, res) => {
  try {
    const { id } = req.params;
    const { additional_minutes } = req.body;
    const userId = req.user.userId;

    if (!additional_minutes || additional_minutes <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Additional minutes must be a positive number'
      });
    }

    const auction = await Auction.findById(id);
    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // Allow both live and upcoming auctions to be extended
    if (auction.status !== 'live') {
      return res.status(400).json({
        success: false,
        message: 'Only live auctions can be extended'
      });
    }

    // Calculate new duration
    const newDuration = auction.duration + additional_minutes; // both in minutes
    
    if (auction.status === 'upcoming') {
      // For upcoming auctions: update duration only
      const result = await db.query(
        'UPDATE auctions SET duration = ?, updated_at = NOW() WHERE id = ?',
        [newDuration, id]
      );
      
      if (result.affectedRows === 0) {
        throw new Error('Failed to update auction duration');
      }
    } else {
      // For live auctions: update duration and extend end_time
      const durationResult = await db.query(
        'UPDATE auctions SET duration = ?, updated_at = NOW() WHERE id = ?',
        [newDuration, id]
      );
      
      if (durationResult.affectedRows === 0) {
        throw new Error('Failed to update auction duration');
      }

      const endTimeResult = await db.query(
        'UPDATE auctions SET end_time = DATE_ADD(end_time, INTERVAL ? MINUTE), updated_at = NOW() WHERE id = ?',
        [additional_minutes, id]
      );
      
      if (endTimeResult.affectedRows === 0) {
        throw new Error('Failed to update auction end time');
      }
    }

    // Fetch the updated auction
    const updatedAuction = await Auction.findById(id);
    
    // Enhanced time formatting function
    const formatTimeToAMPM = (timeValue) => {
      if (!timeValue) return 'N/A';
      
      try {
        let timeString;
        
        // Handle both time strings and datetime objects/strings
        if (typeof timeValue === 'string') {
          if (timeValue.includes('T') || timeValue.includes(' ')) {
            // It's a datetime string - extract time part
            const datetime = new Date(timeValue);
            if (isNaN(datetime.getTime())) {
              return 'N/A'; // Invalid date
            }
            timeString = datetime.toTimeString().split(' ')[0]; // Gets "HH:MM:SS"
          } else {
            // It's already a time string (HH:MM:SS)
            timeString = timeValue;
          }
        } else if (timeValue instanceof Date) {
          // It's a Date object
          timeString = timeValue.toTimeString().split(' ')[0];
        } else {
          return 'N/A';
        }
        
        const [hours, minutes] = timeString.split(':');
        let hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12;
        hour = hour ? hour : 12; // the hour '0' should be '12'
        return `${hour}:${minutes} ${ampm}`;
      } catch (error) {
        console.error('Error formatting time:', error);
        return 'N/A';
      }
    };

    // Format end time based on auction status
    let formattedEndTime = 'N/A';
    if (updatedAuction.status === 'live' && updatedAuction.end_time) {
      formattedEndTime = formatTimeToAMPM(updatedAuction.end_time);
    } else if (updatedAuction.status === 'upcoming') {
      // For upcoming auctions, calculate what the end time will be
      const startDateTime = new Date(`${updatedAuction.date}T${updatedAuction.start_time}`);
      const endDateTime = new Date(startDateTime.getTime() + (newDuration * 1000));
      formattedEndTime = formatTimeToAMPM(endDateTime);
    }

    res.json({
      success: true,
      message: `Auction time extended by ${additional_minutes} minutes`,
      auction: updatedAuction,
      new_duration: newDuration,
      new_end_time: formattedEndTime
    });

  } catch (error) {
    console.error('❌ Extend auction time error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.addParticipants = async (req, res) => {
  try {
    const { auction_id, participants, send_invitations } = req.body;
    const userId = req.user.userId;

    if (!auction_id || !participants) {
      return res.status(400).json({
        success: false,
        message: 'Auction ID and participants are required'
      });
    }

    const auction = await Auction.findById(auction_id);
    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // if (auction.created_by !== userId) {
    //   return res.status(403).json({
    //     success: false,
    //     message: 'Only auction creator can add participants'
    //   });
    // }

    let participantList = Array.isArray(participants) ? participants : [participants];
    participantList = [...new Set(participantList)].filter(p => p);
    
    if (participantList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid participants provided'
      });
    }

    const participantData = participantList.map(phone => ({
      user_id: null,
      phone_number: phone_number   
    }));

    const addedCount = await AuctionParticipant.addMultiple(auction_id, participantData);
    let smsCount = 0;
    let smsFailures = [];

    if (send_invitations === 'true' || send_invitations === true) {
      try {
        const auction = await Auction.findById(auction_id);
        const auctionDate = new Date(auction.auction_date).toLocaleDateString('en-IN');
        const message = `You've been invited to join auction "${auction.title}" on ${auctionDate} at ${auction.start_time}.`;

        for (const participant of participantList) {
          try {
            await sendTwilioSMS(p, msg);
            smsCount++;
          } catch (smsError) {
            console.error(`❌ Failed to send to ${participant}:`, smsError.message);
            smsFailures.push({
              participant: participant,
              error: smsError.message
            });
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (smsError) {
        console.error('❌ Failed to send invitation SMS:', smsError);
      }
    }

    res.json({
      success: true,
      message: `Added ${addedCount} participant(s)${smsCount > 0 ? ` and sent ${smsCount} invitation(s)` : ''}${smsFailures.length > 0 ? `, ${smsFailures.length} failed` : ''}`,
      participants: participantList,
      smsResults: {
        successfulSMS: smsCount,
        failedSMS: smsFailures.length,
        failures: smsFailures
      }
    });

  } catch (error) {
    console.error('❌ Add participants error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.getParticipants = async (req, res) => {
  try {
    const { auction_id } = req.params;

    // basic validation
    const auction = await Auction.findById(auction_id);
    if (!auction)
      return res.status(404).json({ success: false, message: 'Auction not found' });

    /* ---------- auctioneer (creator) ---------- */
    const auctioneer = await getUserById(auction.created_by); // {id, company_name, person_name, phone_number}
    const auctioneerData = {
      id: 0,
      auction_id: Number(auction_id),
      user_id: auction.created_by,
      phone_number: auctioneer?.phone_number || '',
      status: 'auctioneer',
      invited_at: null,
      joined_at: null,
      company_name: auctioneer?.company_name || null,
      person_name: auctioneer?.person_name || null
    };

    /* ---------- invited / joined users ---------- */
    const participants = await AuctionParticipant.findByAuction(auction_id);

    /* ---------- response ---------- */
    res.json({
      success: true,
      auctioneer: auctioneerData,
      participants,
      count: participants.length          // ONLY invited/joined people
    });

  } catch (error) {
    console.error('❌ Get participants error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

exports.joinAuction = async (req, res) => {
  try {
    const { auction_id, phone_number } = req.body;

    if (!auction_id || !phone_number) {
      return res.status(400).json({
        success: false,
        message: 'Auction ID and phone number are required'
      });
    }

    const auction = await Auction.findById(auction_id);
    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    const isParticipant = await AuctionParticipant.isParticipant(auction_id, phone_number);
    if (!isParticipant && !auction.open_to_all) {
      return res.status(403).json({
        success: false,
        message: 'You are not invited to this auction'
      });
    }

    // If not a participant but auction is open to all, add them
    if (!isParticipant && auction.open_to_all) {
      await AuctionParticipant.add({
        auction_id,
        user_id: null,
        phone_number,
        status: 'joined'
      });
    } else {
      await AuctionParticipant.updateStatus(auction_id, phone_number, 'joined');
    }

    res.json({
      success: true,
      message: 'Joined auction successfully'
    });

  } catch (error) {
    console.error('❌ Join auction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.getFilteredAuctions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, type, search } = req.query;
    
    // Update statuses before fetching
    await updateAuctionStatuses();
    
    let query = `
      SELECT a.*, u.company_name as creator_company, u.person_name as creator_name,
             (SELECT COUNT(*) FROM bids WHERE auction_id = a.id) as bid_count,
             (SELECT COUNT(*) FROM auction_participants WHERE auction_id = a.id) as participant_count,
             EXISTS(SELECT 1 FROM bids WHERE auction_id = a.id AND user_id = ?) as has_participated
      FROM auctions a 
      JOIN users u ON a.created_by = u.id 
      WHERE 1=1
    `;
    
    const params = [userId];
    
    // Filter by type (created or participated)
    if (type === 'created') {
      query += ' AND a.created_by = ?';
      params.push(userId);
    } else if (type === 'participated') {
      query += ' AND EXISTS(SELECT 1 FROM bids WHERE auction_id = a.id AND user_id = ?)';
      params.push(userId);
    }
    
    // Filter by status
    if (status && status !== 'all') {
      query += ' AND a.status = ?';
      params.push(status);
    }
    
    // Search filter
    if (search) {
      query += ' AND (a.title LIKE ? OR a.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ' ORDER BY a.auction_date DESC, a.start_time DESC';
    
    const [auctions] = await db.query(query, params);
    
    // Format the response with additional calculated fields
    const formattedAuctions = auctions.map(auction => {
      const now = new Date();
      const auctionDateTime = new Date(`${auction.auction_date}T${auction.start_time}`);
      const endTime = new Date(auctionDateTime.getTime() + auction.duration * 1000);
      
      let timeStatus = '';
      let timeValue = '';
      
      if (auction.status === 'live') {
        const timeRemaining = endTime - now;
        const hours = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
        timeStatus = 'Live';
        timeValue = `• ${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
      } else if (auction.status === 'upcoming') {
        const timeUntilStart = auctionDateTime - now;
        if (timeUntilStart > 0) {
          const days = Math.floor(timeUntilStart / (1000 * 60 * 60 * 24));
          const hours = Math.floor((timeUntilStart % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const minutes = Math.floor((timeUntilStart % (1000 * 60 * 60)) / (1000 * 60));
          timeStatus = 'Starts in';
          timeValue = `${days.toString().padStart(2, '0')}d ${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m`;
        } else {
          timeStatus = 'Starting soon';
          timeValue = '';
        }
      } else if (auction.status === 'completed') {
        timeStatus = 'Completed';
        timeValue = '';
      }
      
      return {
        ...auction,
        timeStatus,
        timeValue,
        access_type: auction.open_to_all ? 'Open to All' : 'Invited Only',
        auction_no: `AUC${auction.id.toString().padStart(3, '0')}`,
        formatted_start_time: formatTimeToAMPM(auction.start_time),
        formatted_end_time: formatTimeToAMPM(auction.end_time) || calculateEndTime(auction.start_time, auction.duration)
      };
    });
    
    res.json({
      success: true,
      auctions: formattedAuctions,
      count: formattedAuctions.length
    });
    
  } catch (error) {
    console.error('❌ Get filtered auctions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.startAuction = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    const auction = await Auction.findById(id);
    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }
    
    // if (auction.created_by !== userId) {
    //   return res.status(403).json({
    //     success: false,
    //     message: 'Only auction creator can start the auction'
    //   });
    // }
    
    if (auction.status !== 'upcoming') {
      return res.status(400).json({
        success: false,
        message: 'Only upcoming auctions can be started'
      });
    }
    
    // Update auction status to live
    await Auction.updateStatus(id, 'live');
    
    // Set end time
    const endTime = new Date(new Date(`${auction.auction_date}T${auction.start_time}`).getTime() + auction.duration * 1000);
    const endTimeFormatted = endTime.toTimeString().split(' ')[0];
    
    await db.query(
      'UPDATE auctions SET end_time = ? WHERE id = ?',
      [endTimeFormatted, id]
    );
    
    const updatedAuction = await Auction.findById(id);
    
    res.json({
      success: true,
      message: 'Auction started successfully',
      auction: updatedAuction
    });
    
  } catch (error) {
    console.error('❌ Start auction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.joinAsAuctioneer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    const auction = await Auction.findById(id);
    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }
    
    // REMOVED THE CREATOR CHECK - Now anyone can join as auctioneer
    // if (auction.created_by !== userId) {
    //   return res.status(403).json({
    //     success: false,
    //     message: 'Only auction creator can join as auctioneer'
    //   });
    // }
    
    if (auction.status !== 'live') {
      return res.status(400).json({
        success: false,
        message: 'Auction is not live'
      });
    }
    
    res.json({
      success: true,
      message: 'Joined as auctioneer successfully',
      auction
    });
    
  } catch (error) {
    console.error('❌ Join as auctioneer error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.downloadReport = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    const auction = await Auction.findById(id);
    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }
    
    // if (auction.created_by !== userId) {
    //   return res.status(403).json({
    //     success: false,
    //     message: 'Only auction creator can download the report'
    //   });
    // }
    
    if (auction.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Report is only available for completed auctions'
      });
    }
    
    // Get auction details with bids and participants
    const participants = await AuctionParticipant.findByAuction(id);
    const bids = await Bid.findByAuction(id);
    const winner = await Bid.findWinningBid(id);
    
    // Generate CSV report
    const csvData = [
      ['Auction Report', '', '', ''],
      ['Auction Title:', auction.title, 'Auction No:', `AUC${id.toString().padStart(3, '0')}`],
      ['Date & Time:', `${auction.auction_date} at ${formatTimeToAMPM(auction.start_time)}`, 'Currency:', auction.currency],
      ['Decremental Value:', auction.decremental_value, 'Final Price:', auction.current_price],
      ['', '', '', ''],
      ['Participants:', '', '', ''],
      ['Name', 'phone_number', 'Company', 'Status']
    ];
    
    participants.forEach(p => {
      csvData.push([
        p.person_name || 'N/A',
        p.phone_number,
        p.company_name || 'N/A',
        p.status || 'invited'
      ]);
    });
    
    csvData.push(['', '', '', '']);
    csvData.push(['Bids:', '', '', '']);
    csvData.push(['Bidder', 'Company', 'Amount', 'Time']);
    
    bids.forEach(b => {
      const bidTime = new Date(b.bid_time).toLocaleString();
      csvData.push([
        b.person_name,
        b.company_name,
        b.amount,
        bidTime
      ]);
    });
    
    csvData.push(['', '', '', '']);
    csvData.push(['Winner:', winner ? winner.person_name : 'No winner', '', '']);
    
    // Convert to CSV string
    const csvString = csvData.map(row => row.join(',')).join('\n');
    
    // Set response headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=auction-${id}-report.csv`);
    
    // Send the CSV
    res.send(csvString);
    
  } catch (error) {
    console.error('❌ Download report error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

async function getUserById(userId) {
  const [rows] = await db.query(
    'SELECT id, company_name, person_name, phone_number FROM users WHERE id = ?',
    [userId]
  );
  return rows[0] || null;
}
