/* --------------  IST locking  -------------- */
const { formatInTimeZone, toZonedTime } = require('date-fns-tz');
const TZ   = 'Asia/Kolkata';
/* ------------------------------------------- */

const axios   = require('axios');
const Auction = require('../models/Auction');
const AuctionParticipant = require('../models/AuctionParticipant');
const AuctionDocument = require('../models/AuctionDocument');
const Bid   = require('../models/Bid');
const { sendTwilioSMS } = require('../utils/twilio');
const db    = require('../db');

// ------------------------------------------------------------------
// helpers – pure functions, no external vars
// ------------------------------------------------------------------
function calcEndTimeHHMMSS(startTime, durationMin) {
  if (!startTime || !durationMin) return null;
  const [h = 0, m = 0, s = 0] = startTime.split(':').map(Number);
  const start = new Date();
  start.setHours(h, m, s, 0);
  const end = new Date(start.getTime() + durationMin * 60 * 1000); // minutes → ms
  const hh = end.getHours().toString().padStart(2, '0');
  const mm = end.getMinutes().toString().padStart(2, '0');
  const ss = end.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatTimeToAMPM(timeValue) {
  if (!timeValue) return 'N/A';

  // 1.  Date → "HH:MM:SS"
  if (timeValue instanceof Date) {
    timeValue = timeValue.toTimeString().split(' ')[0];
  }
  // 2.  datetime string → "HH:MM:SS"
  if (typeof timeValue === 'string' && (timeValue.includes('T') || timeValue.includes(' '))) {
    timeValue = new Date(timeValue).toTimeString().split(' ')[0];
  }

  // 3.  split and guard
  const parts = String(timeValue).split(':');
  if (parts.length < 2) return 'N/A';          // ← NEW: bad shape → bail out

  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
}

/* ----- internal notification helpers ----- */
async function notify(userIds, type, auctionId, message) {
  // Handle single user or array of users
  const userIdArray = Array.isArray(userIds) ? userIds : [userIds];
  
  for (const userId of userIdArray) {
    await db.query(
      `INSERT INTO notifications (user_id, type, auction_id, message, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [userId, type, auctionId, message]
    );
  }
}

// ------------------------------------------------------------------
// status updater & cron
// ------------------------------------------------------------------
let statusUpdateInterval;

async function updateAuctionStatuses() {
  let conn;
  try {
    const nowIST = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    conn = await db.getConnection(); await conn.beginTransaction();

    /* 1. completed */
    await conn.query(`
      UPDATE auctions
      SET status = 'completed',
          end_time = DATE_FORMAT(CONCAT(auction_date,' ',start_time) + INTERVAL duration MINUTE,'%H:%i:%s')
      WHERE (status = 'live' OR status = 'upcoming')
        AND CONCAT(auction_date,' ',start_time) + INTERVAL duration MINUTE <= NOW()
    `);
    /* 2. live */
    await conn.query(`
      UPDATE auctions
      SET status = 'live',
          end_time = DATE_FORMAT(CONCAT(auction_date,' ',start_time) + INTERVAL duration MINUTE,'%H:%i:%s')
      WHERE status = 'upcoming'
        AND CONCAT(auction_date,' ',start_time) <= NOW()
        AND CONCAT(auction_date,' ',start_time) + INTERVAL duration MINUTE > NOW()
    `);
    await conn.commit();
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('❌ Status update error:', err); throw err;
  } finally { if (conn) conn.release(); }
}

function startAutomaticStatusUpdates() {
  if (statusUpdateInterval) clearInterval(statusUpdateInterval);
  updateAuctionStatuses().then(() => console.log('✅ Initial status update')).catch(console.error);
  statusUpdateInterval = setInterval(() => updateAuctionStatuses().catch(console.error), 30000);
  console.log('✅ Auto status updates every 30 s (IST)');
}
startAutomaticStatusUpdates();

process.on('SIGINT', () => {
  if (statusUpdateInterval) { clearInterval(statusUpdateInterval); console.log('❌ Auto updates stopped'); }
  process.exit(0);
});

// ------------------------------------------------------------------
// endpoints
// ------------------------------------------------------------------
exports.autoUpdateAuctionStatus = async (req, res) => {
  try {
    await updateAuctionStatuses();
    res.json({ success: true, message: 'Manual update done', timestamp: new Date() });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Update failed', error: e.message });
  }
};

/* ----------------------------------------------------------
   CREATE AUCTION – stores end_time in DB
---------------------------------------------------------- */
exports.createAuction = async (req, res) => {
  try {
    const {
      title, description, auction_date, start_time, duration, currency,
      decremental_value, pre_bid_allowed = true, participants, send_invitations = true,
      open_to_all = false
    } = req.body;

    if (!title || !auction_date || !start_time || !duration || !decremental_value)
      return res.status(400).json({ success: false, message: 'Required fields missing' });

    const timeRE = /^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
    if (!timeRE.test(start_time))
      return res.status(400).json({ success: false, message: 'start_time must be valid HH:MM:SS (00-23)' });

    const created_by = req.user.userId;
    const end_time = calcEndTimeHHMMSS(start_time, parseInt(duration, 10));

    const auctionId = await Auction.create({
      title, description, auction_date, start_time, end_time,
      duration: parseInt(duration, 10),
      currency: currency || 'INR',
      decremental_value: parseFloat(decremental_value),
      current_price: parseFloat(decremental_value),
      pre_bid_allowed: pre_bid_allowed === 'true' || pre_bid_allowed === true,
      open_to_all: open_to_all === 'true' || open_to_all === true,
      created_by
    });

    await updateAuctionStatuses();

    let participantList = [], smsCount = 0;

    if (participants) {
      let parsed = participants;

      if (typeof participants === "string") {
        try {
          parsed = JSON.parse(participants);
        } catch {
          parsed = participants.split(",");
        }
      }

      participantList = [...new Set(
        (Array.isArray(parsed) ? parsed : [parsed])
          .map(p => String(p).replace(/[\[\]"]/g, "").trim())
          .filter(Boolean)
      )];

      if (participantList.length) {
        await AuctionParticipant.addMultiple(
          auctionId,
          participantList.map(p => ({
            user_id: null,
            phone_number: p,
            status: "invited",
            invited_at: new Date()
          }))
        );

        if (send_invitations === 'true' || send_invitations === true) {
          const auction = await Auction.findById(auctionId);
          const auctionDate = new Date(auction.auction_date).toLocaleDateString('en-IN');
          const msg = `Join "${auction.title}" auction on ${auctionDate} at ${auction.start_time}. Website: https://soft-macaron-8cac07.netlify.app/register  `;

          for (const p of participantList) {
            try {
              await sendTwilioSMS(p, msg);
              smsCount++;
            } catch (e) {
              console.error(`❌ Failed to send SMS to ${p}:`, e.message);
            }
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
    }
    // notify creator AND participants
if (participantList.length) {
  // Notify creator
  await notify(created_by, 'participant_added', auctionId,
    `${participantList.length} participant(s) added to your auction "${title}".`);
  
  // Notify each participant
  const participantMessage = `You've been added to auction "${title}" on ${auction_date} at ${start_time}.`;
  
  // Get user IDs for participants by phone numbers
  const phoneNumbers = participantList.map(p => p.replace(/[^0-9]/g, ''));
  if (phoneNumbers.length > 0) {
    const [users] = await db.query(
      'SELECT id FROM users WHERE phone_number IN (?)',
      [phoneNumbers]
    );
    
    const participantUserIds = users.map(user => user.id);
    if (participantUserIds.length > 0) {
      await notify(participantUserIds, 'added_to_auction', auctionId, participantMessage);
    }
  }
}
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
        uploadedDocs.push({
          id: docId,
          file_name: file.originalname,
          file_url: fileUrl,
          file_type: file.mimetype
        });
      }
    }

    const auction = await Auction.findById(auctionId);

    return res.status(201).json({
      success: true,
      message: open_to_all
        ? 'Auction created – open to all suppliers'
        : `Auction created with ${participantList.length} participant(s)${smsCount ? `, ${smsCount} SMS` : ''}`,
      auction: {
        ...auction,
        end_time,
        formatted_start_time: formatTimeToAMPM(auction.start_time),
        formatted_end_time: formatTimeToAMPM(end_time)
      },
      invitationResults: open_to_all
        ? { totalParticipants: 0, successfulSMS: 0, note: 'Open to all suppliers' }
        : { totalParticipants: participantList.length, successfulSMS: smsCount },
      documents: uploadedDocs
    });
  } catch (e) {
    console.error('❌ Create auction:', e);
    return res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// PATCH API - Update decremental_value in DB
exports.updateDecrementalValue = async (req, res) => {
  try {
    const { id } = req.params;
    const { decremental_value } = req.body;

    if (!decremental_value) {
      return res.status(400).json({
        success: false,
        message: "decremental_value is required"
      });
    }

    // check if auction exists
    const [auction] = await db.query("SELECT * FROM auctions WHERE id = ?", [id]);
    if (!auction.length) {
      return res.status(404).json({ success: false, message: "Auction not found" });
    }

    const updatedValue = parseFloat(decremental_value);

    // update in database (also updating current_price same as decremental_value)
    await db.query(
      "UPDATE auctions SET decremental_value = ?, current_price = ? WHERE id = ?",
      [updatedValue, updatedValue, id]
    );

    return res.status(200).json({
      success: true,
      message: "Decremental value updated successfully",
      auction: {
        ...auction[0],
        decremental_value: updatedValue,
        current_price: updatedValue
      }
    });
  } catch (e) {
    console.error("❌ Update decremental_value:", e);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: e.message
    });
  }
};

/* ------------------------------------------------------------------
   GET AUCTION DETAILS – fixed end-time formatter
   ------------------------------------------------------------------ */
/* ------------------------------------------------------------------
   GET AUCTION DETAILS – returns ALL participant rows (no status filter)
   ------------------------------------------------------------------ */
exports.getAuctionDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    if (!id) return res.status(400).json({ success: false, message: 'Auction ID is required' });

    const auction = await Auction.findById(id);
    if (!auction) return res.status(404).json({ success: false, message: 'Auction not found' });

    const isCreator = auction.created_by === userId;
    const userPhone = req.user.phone_number || '';
    const isParticipant = await AuctionParticipant.isParticipant(id, userPhone);
    const hasBid = await Bid.hasUserBid(id, userId);

    if (!isCreator && !isParticipant && !hasBid && !auction.open_to_all)
      return res.status(403).json({ success: false, message: 'You do not have access to this auction' });

    /* ----------  NEW:  fetch every row for this auction  ---------- */
    const [participantsRows] = await db.query(
      `SELECT ap.id,
              ap.user_id,
              ap.phone_number,
              ap.status,
              ap.invited_at,
              ap.joined_at,
              u.person_name,
              u.company_name
       FROM auction_participants ap
       LEFT JOIN users u ON u.phone_number = ap.phone_number
       WHERE ap.auction_id = ?`,
      [id]
    );

    const [bids, documents, winner, creator] = await Promise.all([
      Bid.findByAuction(id),
      AuctionDocument.findByAuction(id),
      Bid.findWinningBid(id),
      getUserById(auction.created_by)
    ]);

    /* ----------  time helpers (unchanged)  ---------- */
    const formattedEndTime = auction.end_time
      ? formatTimeToAMPM(auction.end_time)
      : formatTimeToAMPM(calcEndTimeHHMMSS(auction.start_time, auction.duration / 60));

    const now = new Date();
    const auctionDateTime = new Date(`${auction.auction_date}T${auction.start_time}`);
    const endDateTime = new Date(auctionDateTime.getTime() + auction.duration * 1000);

    let timeStatus = auction.status;
    let timeValue = '';
    let timeRemaining = 0;

    if (auction.status === 'live') {
      timeRemaining = endDateTime - now;
      if (timeRemaining > 0) {
        const h = Math.floor((timeRemaining % 864e5) / 36e5);
        const m = Math.floor((timeRemaining % 36e5) / 6e4);
        const s = Math.floor((timeRemaining % 6e4) / 1e3);
        timeStatus = 'Live';
        timeValue = `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
      } else timeStatus = 'Ended';
    } else if (auction.status === 'upcoming') {
      timeRemaining = auctionDateTime - now;
      if (timeRemaining > 0) {
        const d = Math.floor(timeRemaining / 864e5);
        const h = Math.floor((timeRemaining % 864e5) / 36e5);
        const m = Math.floor((timeRemaining % 36e5) / 6e4);
        timeStatus = 'Starts in';
        timeValue = `${d}d ${h}h ${m}m`;
      } else timeStatus = 'Starting soon';
    }

    /* ----------  response  ---------- */
    res.json({
      success: true,
      auction: {
        ...auction,
        auction_no: `AUC${auction.id.toString().padStart(3, '0')}`,
        formatted_start_time: formatTimeToAMPM(auction.start_time),
        formatted_end_time: formattedEndTime,
        time_remaining: timeRemaining,
        time_status: timeStatus,
        time_value: timeValue,
        is_creator: isCreator,
        has_joined: isParticipant,
        has_bid: hasBid,
        open_to_all: auction.open_to_all,
        creator_info: creator ? {
          company_name: creator.company_name,
          person_name: creator.person_name,
          phone: creator.phone_number,
          email: creator.email,
        } : null,
        winner_info: winner ? {
          user_id: winner.user_id,
          person_name: winner.person_name,
          company_name: winner.company_name,
          amount: winner.amount
        } : null,
        participants: participantsRows, // ← every row, no filter
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
          total_participants: participantsRows.length,
          total_bids: bids.length,
          active_participants: participantsRows.filter(p => p.status === 'joined').length,
          highest_bid: bids.length > 0 ? Math.max(...bids.map(b => parseFloat(b.amount || 0))) : null,
          lowest_bid: bids.length > 0 ? Math.min(...bids.map(b => parseFloat(b.amount || 0))) : null
        }
      }
    });

  } catch (error) {
    console.error('❌ Get auction details error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// ------------------------------------------------------------------
// utility used by several handlers
async function getUserById(userId) {
  const [rows] = await db.query(
    'SELECT id, company_name, person_name, phone_number FROM users WHERE id = ?',
    [userId]
  );
  return rows[0] || null;
}

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
    const { auction_id: rawAuctionId, amount: rawAmount } = req.body;
    const userId = req.user.userId;

    /* ---------- basic validation ---------- */
    if (!rawAuctionId || !rawAmount) {
      return res.status(400).json({
        success: false,
        message: 'Auction ID and bid amount are required'
      });
    }

    const auctionId = Number(rawAuctionId);
    const bidAmount = Number(rawAmount);
    if (isNaN(auctionId) || isNaN(bidAmount) || bidAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid auction ID or bid amount'
      });
    }

    /* ---------- auction must be open ---------- */
    await updateAuctionStatuses();
    const auction = await Auction.findById(auctionId);
    if (!auction) {
      return res.status(404).json({ success: false, message: 'Auction not found' });
    }
    if (!['live', 'upcoming'].includes(auction.status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Bids can only be placed on upcoming or live auctions'
      });
    }

    /* ---------- decremental rule ---------- */
    const decrement = Math.max(0, parseFloat(auction.decremental_value) || 0);

    const existingBids = await Bid.findByAuction(auctionId);

    if (existingBids.length > 0) {
      // Subsequent bids: check decremental rule
      const lowestBid = Math.min(...existingBids.map(b => parseFloat(b.amount)));
      const rawCeiling = lowestBid - decrement;
      const humanCeiling = Math.max(0, rawCeiling);

      if (bidAmount > rawCeiling) {
        return res.status(400).json({
          success: false,
          message:
            rawCeiling < 0
              ? `Bid must be ≤ ${humanCeiling} (price floor reached)`
              : `Bid must be ≤ ${humanCeiling} (current lowest ${lowestBid} - decrement ${decrement})`
        });
      }
    } // First bid can be any positive value

    /* ---------- auto-register participant ---------- */
    try {
      const [[userRow]] = await db.query(
        'SELECT phone_number FROM users WHERE id = ?', [userId]
      );
      if (userRow) {
        const phone = userRow.phone_number;
        const [[participant]] = await db.query(
          'SELECT id FROM auction_participants WHERE auction_id = ? AND phone_number = ?',
          [auctionId, phone]
        );
        if (!participant) {
          await db.query(
            `INSERT INTO auction_participants
             (auction_id, phone_number, user_id, status, joined_at)
             VALUES (?, ?, ?, 'approved', NOW())`,
            [auctionId, phone, userId]
          );
        }
      }
    } catch (e) {
      console.warn('Auto-registration skipped:', e.message);
    }

    /* ---------- persist bid ---------- */
    const bidId = await Bid.create({
      auction_id: auctionId,
      user_id: userId,
      amount: bidAmount
    });

    await Auction.updateCurrentPrice(auctionId, bidAmount);
    if (auction.status.toLowerCase() === 'live') {
      await Bid.setWinningBid(bidId);
    }

    /* ---------- NOTIFICATIONS ---------- */
    try {
      // Get user info for notification
      const [[bidderInfo]] = await db.query(
        'SELECT person_name, company_name FROM users WHERE id = ?', 
        [userId]
      );

      // 1. Notify auction creator about the new bid
      const creatorMessage = `New bid of ${bidAmount} ${auction.currency} placed by ${bidderInfo.person_name || 'a participant'} from ${bidderInfo.company_name || 'unknown company'} on your auction "${auction.title}".`;
      
      await db.query(
        `INSERT INTO notifications (user_id, type, auction_id, message, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [auction.created_by, 'new_bid', auctionId, creatorMessage]
      );

      // 2. Notify all other participants about the new bid (except the bidder)
      const participants = await AuctionParticipant.findByAuction(auctionId);
      const participantIds = participants
        .filter(p => p.user_id && p.user_id !== userId)
        .map(p => p.user_id);

      if (participantIds.length > 0) {
        const participantMessage = `New bid of ${bidAmount} ${auction.currency} placed on auction "${auction.title}".`;
        
        for (const participantId of participantIds) {
          await db.query(
            `INSERT INTO notifications (user_id, type, auction_id, message, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [participantId, 'new_bid', auctionId, participantMessage]
          );
        }
      }

      // 3. If this is the new winning bid, notify the previous winner (if any)
      if (auction.status.toLowerCase() === 'live') {
        const [previousWinningBids] = await db.query(
          'SELECT user_id FROM bids WHERE auction_id = ? AND is_winning = 1 AND user_id != ?',
          [auctionId, userId]
        );

        if (previousWinningBids.length > 0) {
          const previousWinnerId = previousWinningBids[0].user_id;
          const outbidMessage = `You've been outbid on auction "${auction.title}". Current winning bid is ${bidAmount} ${auction.currency}.`;
          
          await db.query(
            `INSERT INTO notifications (user_id, type, auction_id, message, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [previousWinnerId, 'outbid', auctionId, outbidMessage]
          );
        }
      }

    } catch (notificationError) {
      console.warn('Notification creation failed:', notificationError.message);
      // Don't fail the bid placement if notifications fail
    }

    /* ---------- response ---------- */
    const updatedAuction = await Auction.findById(auctionId);
    const bids = await Bid.findByAuction(auctionId);

    res.json({
      success: true,
      message: 'Bid placed successfully',
      bid: {
        id: bidId,
        auction_id: auctionId,
        user_id: userId,
        amount: bidAmount,
        bid_time: new Date()
      },
      auction: updatedAuction,
      bids
    });
  } catch (err) {
    console.error('❌ placeBid error:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
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

    // notify winner AND creator
if (winnerId) {
  const winnerMsg = `🎉 You won auction "${auction.title}" with bid ${winningBid.amount} ${auction.currency}.`;
  await notify(winnerId, 'won_auction', id, winnerMsg);
  
  // Also notify auction creator about the winner
  const creatorMsg = `Auction "${auction.title}" has been won by a participant with bid ${winningBid.amount} ${auction.currency}.`;
  await notify(auction.created_by, 'auction_completed', id, creatorMsg);
} else {
  // Notify creator if no winner
  const noWinnerMsg = `Auction "${auction.title}" completed with no winning bid.`;
  await notify(auction.created_by, 'auction_completed', id, noWinnerMsg);
}
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
      phone_number: phone   
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
            await sendTwilioSMS(participant, message);
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
    if (!auction_id) return res.status(400).json({ success: false, message: 'Auction ID required' });

    /* ---------- basic validation ---------- */
    const auction = await Auction.findById(auction_id);
    if (!auction) return res.status(404).json({ success: false, message: 'Auction not found' });

    /* ---------- parallel data fetch ---------- */
    const [participants, bids, documents, winner, creator] = await Promise.all([
      AuctionParticipant.findByAuction(auction_id),
      Bid.findByAuction(auction_id),
      AuctionDocument.findByAuction(auction_id),
      Bid.findWinningBid(auction_id),
      getUserById(auction.created_by)
    ]);

    /* ---------- time helpers (re-used from getAuctionDetails) ---------- */
    const now = new Date();
    const auctionDateTime = new Date(`${auction.auction_date}T${auction.start_time}`);

    let endTime;
    if (auction.end_time) {
      if (typeof auction.end_time === 'string' && auction.end_time.includes(' ')) {
        const [, timePart] = auction.end_time.split(' ');
        endTime = new Date(`${auction.auction_date}T${timePart}`);
      } else {
        endTime = new Date(`${auction.auction_date}T${auction.end_time}`);
      }
    } else if (auction.start_time && auction.duration) {
      endTime = new Date(auctionDateTime.getTime() + auction.duration * 1000); // seconds in DB
    } else endTime = null;

    let timeStatus = auction.status;
    let timeValue = '';
    let timeRemaining = 0;

    if (auction.status === 'live' && endTime) {
      timeRemaining = endTime - now;
      if (timeRemaining > 0) {
        const h = Math.floor((timeRemaining % 864e5) / 36e5);
        const m = Math.floor((timeRemaining % 36e5) / 6e4);
        const s = Math.floor((timeRemaining % 6e4) / 1e3);
        timeStatus = 'Live';
        timeValue = `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
      } else timeStatus = 'Ended';
    } else if (auction.status === 'upcoming') {
      timeRemaining = auctionDateTime - now;
      if (timeRemaining > 0) {
        const d = Math.floor(timeRemaining / 864e5);
        const h = Math.floor((timeRemaining % 864e5) / 36e5);
        const m = Math.floor((timeRemaining % 36e5) / 6e4);
        timeStatus = 'Starts in';
        timeValue = `${d}d ${h}h ${m}m`;
      } else timeStatus = 'Starting soon';
    }

    /* ---------- ranking (lowest amount first) ---------- */
    const ranking = [...bids]
      .sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))
      .map((b, idx) => ({
        rank: idx + 1,
        user_id: b.user_id,
        person_name: b.person_name,
        company_name: b.company_name,
        amount: b.amount,
        bid_time: b.bid_time,
        is_winning: b.is_winning
      }));

    /* ---------- response ---------- */
    res.json({
      success: true,
      auction: {
        ...auction,
        auction_no: `AUC${auction.id.toString().padStart(3, '0')}`,
        formatted_start_time: formatTimeToAMPM(auction.start_time),
        formatted_end_time: auction.end_time
        ? formatTimeToAMPM(auction.end_time)
        : formatTimeToAMPM(calcEndTimeHHMMSS(auction.start_time, auction.duration / 60)),
        time_remaining: timeRemaining,
        time_status: timeStatus,
        time_value: timeValue
      },
      auctioneer: creator ? {
        id: 0,
        auction_id: Number(auction_id),
        user_id: auction.created_by,
        phone_number: creator.phone_number || '',
        status: 'auctioneer',
        invited_at: null,
        joined_at: null,
        company_name: creator.company_name || null,
        person_name: creator.person_name || null
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
      bids,
      bid_ranking: ranking,
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
        highest_bid: bids.length
  ? Math.max(...bids.map(b => parseFloat(b.amount || 0)))
  : parseFloat(auction.current_price || 0),
lowest_bid: bids.length
  ? Math.min(...bids.map(b => parseFloat(b.amount || 0)))
  : parseFloat(auction.current_price || 0),
      }
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
      WHERE (a.open_to_all = 1 OR EXISTS(SELECT 1 FROM auction_participants WHERE auction_id = a.id))
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
    'SELECT id, company_name, person_name, phone_number, email FROM users WHERE id = ?',
    [userId]
  );
  return rows[0] || null;
}

// Get user's pre-bid for an auction
exports.getMyPreBid = async (req, res) => {
  try {
    const auctionId = parseInt(req.params.id, 10);
    if (isNaN(auctionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid auction ID'
      });
    }

    // Get user's pre-bid
    const [bidRows] = await db.query(`
      SELECT b.*, COALESCE(b.status, 'pending') as status
      FROM bids b
      WHERE b.auction_id = ? AND b.user_id = ?
      ORDER BY b.bid_time DESC
      LIMIT 1
    `, [auctionId, req.user.userId]);

    if (!bidRows || bidRows.length === 0) {
      return res.json({
        success: true,
        hasPrebid: false,
        prebid: null
      });
    }

    res.json({
      success: true,
      hasPrebid: true,
      prebid: bidRows[0]
    });

  } catch (error) {
    console.error('❌ Get my pre-bid error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Submit pre-bid for participants
exports.submitPreBid = async (req, res) => {
  try {
    const { auction_id, phone_number, amount } = req.body;
    
    // Input validation
    if (!auction_id || !phone_number || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: auction_id, phone_number, amount'
      });
    }

    const bidAmount = parseFloat(amount);
    if (isNaN(bidAmount) || bidAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bid amount'
      });
    }

    // Get auction details
    const auction = await Auction.findById(auction_id);
    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // Check if auction allows pre-bids
    if (!auction.pre_bid_allowed) {
      return res.status(400).json({
        success: false,
        message: 'Pre-bidding is not allowed for this auction'
      });
    }

    // Check auction status - allow pre-bids for upcoming and live auctions
    if (auction.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot submit pre-bid for completed auction'
      });
    }

    // Get user by phone number
    const [userRows] = await db.query(
      'SELECT id, person_name, company_name FROM users WHERE phone_number = ?',
      [phone_number]
    );

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found with provided phone number'
      });
    }

    const user = userRows[0];

    // Check if user is a participant in this auction, if not auto-register them
    const [participantRows] = await db.query(
      'SELECT * FROM auction_participants WHERE auction_id = ? AND phone_number = ?',
      [auction_id, phone_number]
    );

    if (!participantRows || participantRows.length === 0) {
      // Auto-register the user as a participant when they place a bid
      try {
        await db.query(
          'INSERT INTO auction_participants (auction_id, phone_number, user_id, status, joined_at) VALUES (?, ?, ?, ?, NOW())',
          [auction_id, phone_number, user.id, 'approved']
        );
        console.log(`Auto-registered user ${phone_number} for auction ${auction_id}`);
      } catch (insertError) {
        console.error('Error auto-registering participant:', insertError);
        // Continue anyway - the bid is more important than the participant record
      }
    }

    // Implement new bidding logic: current lowest bid - decremental value
    const decrementalValue = parseFloat(auction.decremental_value || 0);
    const startingPrice = parseFloat(auction.current_price || 0);
    
    // Get existing bids for this auction
    let existingBids;
    try {
      const [result] = await db.query(
        'SELECT amount FROM bids WHERE auction_id = ? AND (status = "approved" OR status IS NULL)',
        [auction_id]
      );
      existingBids = result;
    } catch (error) {
      // If status column doesn't exist, get all bids
      const [result] = await db.query('SELECT amount FROM bids WHERE auction_id = ?', [auction_id]);
      existingBids = result;
    }

    // Determine current lowest bid
    let currentLowestBid = startingPrice;
    if (existingBids && existingBids.length > 0) {
      const bidAmounts = existingBids.map(bid => parseFloat(bid.amount));
      currentLowestBid = Math.min(...bidAmounts);
    }

    // Calculate minimum allowed bid: currentLowestBid - decrementalValue
    const minimumAllowedBid = currentLowestBid - decrementalValue;

    // Validation 1: bid must be lower than current lowest bid
    if (bidAmount >= currentLowestBid) {
      return res.status(400).json({
        success: false,
        message: `Your bid (${auction.currency} ${bidAmount.toLocaleString()}) must be lower than the current lowest bid (${auction.currency} ${currentLowestBid.toLocaleString()})`,
        currentLowestBid,
        minimumAllowedBid
      });
    }

    // Validation 2: bid cannot be lower than minimum allowed (currentLowest - decremental)
    if (bidAmount < minimumAllowedBid) {
      return res.status(400).json({
        success: false,
        message: `Your bid (${auction.currency} ${bidAmount.toLocaleString()}) is too low. Minimum allowed bid is ${auction.currency} ${minimumAllowedBid.toLocaleString()}. Logic: Current lowest (${auction.currency} ${currentLowestBid.toLocaleString()}) - Decremental value (${auction.currency} ${decrementalValue.toLocaleString()}) = ${auction.currency} ${minimumAllowedBid.toLocaleString()}`,
        currentLowestBid,
        minimumAllowedBid,
        decrementalValue
      });
    }

    // Validation 3: bid should not be negative
    if (bidAmount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Bid amount cannot be negative'
      });
    }

    // Check if user has already submitted a pre-bid for this auction
    const [existingPreBidRows] = await db.query(
      'SELECT id FROM bids WHERE auction_id = ? AND user_id = ?',
      [auction_id, user.id]
    );

    // If user already has a bid, update it; otherwise create new one
    let bidId;
    if (existingPreBidRows && existingPreBidRows.length > 0) {
      // Update existing bid
      bidId = existingPreBidRows[0].id;
      try {
        await db.query(
          'UPDATE bids SET amount = ?, bid_time = NOW(), status = ? WHERE id = ?',
          [bidAmount, 'pending', bidId]
        );
      } catch (error) {
        // If status column doesn't exist, fall back to basic update
        await db.query(
          'UPDATE bids SET amount = ?, bid_time = NOW() WHERE id = ?',
          [bidAmount, bidId]
        );
      }
    } else {
      // Create new bid
      try {
        bidId = await Bid.create({
          auction_id: auction_id,
          user_id: user.id,
          amount: bidAmount,
          status: 'pending'
        });
      } catch (error) {
        // If status column doesn't exist, fall back to basic create
        bidId = await Bid.create({
          auction_id: auction_id,
          user_id: user.id,
          amount: bidAmount
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Pre-bid submitted successfully',
      bidId,
      bidAmount,
      currentLowestBid,
      minimumAllowedBid,
      status: 'pending'
    });

  } catch (error) {
    console.error('❌ Submit pre-bid error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get pre-bids for an auction
// Get pre-bids for an auction  (ONLY pending / non-rejected)
exports.getPreBids = async (req, res) => {
  try {
    const auctionId = parseInt(req.params.id, 10);
    if (isNaN(auctionId))
      return res.status(400).json({ success: false, message: 'Invalid auction ID' });

    // ownership check
    const auction = await Auction.findById(auctionId);
    if (!auction)
      return res.status(404).json({ success: false, message: 'Auction not found' });
    if (auction.created_by !== req.user.userId)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    let prebids;

    /* 1️⃣  DB with status column  –  exclude rejected  */
    try {
      const [rows] = await db.query(`
        SELECT 
          b.id,
          b.amount,
          b.bid_time,
          COALESCE(b.status,'pending')  AS status,
          u.person_name,
          u.company_name,
          u.phone_number,
          u.email
        FROM bids b
        JOIN users u ON u.id = b.user_id
        WHERE b.auction_id = ?
          AND (b.status <> 'rejected' OR b.status IS NULL)   -- ➜  hide rejected
          AND (b.is_winning = 0 OR b.is_winning IS NULL)
        ORDER BY b.amount ASC, b.bid_time ASC
      `, [auctionId]);
      prebids = rows;
    } catch (err) {
      /* 2️⃣  Fallback:  no status column  –  treat everything as pending  */
      const [rows] = await db.query(`
        SELECT 
          b.id,
          b.amount,
          b.bid_time,
          'pending'                       AS status,
          u.person_name,
          u.company_name,
          u.phone_number,
          u.email
        FROM bids b
        JOIN users u ON u.id = b.user_id
        WHERE b.auction_id = ?
          AND (b.is_winning = 0 OR b.is_winning IS NULL)
        ORDER BY b.amount ASC, b.bid_time ASC
      `, [auctionId]);
      prebids = rows;
    }

    return res.json({ success: true, prebids });
  } catch (e) {
    console.error('❌ getPreBids:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Approve a pre-bid
exports.approvePreBid = async (req, res) => {
  try {
    const preBidId = parseInt(req.params.id, 10);
    if (isNaN(preBidId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pre-bid ID'
      });
    }

    // Get the pre-bid and verify ownership
    const [prebidRows] = await db.query(`
      SELECT b.*, a.created_by, a.decremental_value, a.current_price
      FROM bids b
      JOIN auctions a ON b.auction_id = a.id
      WHERE b.id = ?
    `, [preBidId]);

    if (!prebidRows || prebidRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Pre-bid not found'
      });
    }

    const prebid = prebidRows[0];
    
    if (prebid.created_by !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this pre-bid'
      });
    }

    // Validate the pre-bid amount using the same logic
    const decrementalValue = parseFloat(prebid.decremental_value || 0);
    const currentPrice = parseFloat(prebid.current_price || 0);
    const bidAmount = parseFloat(prebid.amount);
    
    // Get current lowest bid for the auction
    let existingBids;
    try {
      const [result] = await db.query('SELECT amount FROM bids WHERE auction_id = ? AND (status = "active" OR status IS NULL)', [prebid.auction_id]);
      existingBids = result;
    } catch (error) {
      // If status column doesn't exist, get all bids
      const [result] = await db.query('SELECT amount FROM bids WHERE auction_id = ?', [prebid.auction_id]);
      existingBids = result;
    }
    let lowestBid = currentPrice;
    
    if (existingBids && existingBids.length > 0) {
      lowestBid = Math.min(...existingBids.map(b => parseFloat(b.amount || currentPrice)));
    }
    
    const minimumAllowedBid = lowestBid - decrementalValue;
    
    if (bidAmount < minimumAllowedBid) {
      return res.status(400).json({
        success: false,
        message: `Cannot approve pre-bid. Bid amount ${bidAmount} is below minimum allowed ${minimumAllowedBid} (lowest bid ${lowestBid} - decremental value ${decrementalValue})`
      });
    }

    // Update pre-bid status to approved
    try {
      await db.query(
        'UPDATE bids SET status = "approved" WHERE id = ?',
        [preBidId]
      );
    } catch (error) {
      // If status column doesn't exist, we'll just note it's approved in response
      console.log('Note: Status column not available, pre-bid conceptually approved');
    }

    res.json({
      success: true,
      message: 'Pre-bid approved successfully'
    });

  } catch (error) {
    console.error('❌ Approve pre-bid error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};


// Reject and delete a pre-bid
exports.rejectPreBid = async (req, res) => {
  try {
    const preBidId = parseInt(req.params.id, 10);
    if (isNaN(preBidId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pre-bid ID'
      });
    }

    // Get the pre-bid and verify ownership
    const [prebidRows] = await db.query(`
      SELECT b.*, a.created_by, a.id as auction_id
      FROM bids b
      JOIN auctions a ON b.auction_id = a.id
      WHERE b.id = ?
    `, [preBidId]);

    if (!prebidRows || prebidRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Pre-bid not found'
      });
    }

    const prebid = prebidRows[0];
    
    if (prebid.created_by !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this pre-bid'
      });
    }

    // Start transaction for consistent state
    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      // Check if this was the winning bid
      const [wasWinning] = await conn.query(
        'SELECT is_winning FROM bids WHERE id = ? AND is_winning = 1',
        [preBidId]
      );

      // Store auction_id before deleting
      const auctionId = prebid.auction_id;

      // DELETE the pre-bid completely from database
      await conn.query('DELETE FROM bids WHERE id = ?', [preBidId]);

      // If it was winning bid, find new winner
      if (wasWinning && wasWinning.length > 0) {
        // Find the next best active bid
        const [nextBestBid] = await conn.query(`
          SELECT id, amount 
          FROM bids 
          WHERE auction_id = ? 
          ORDER BY amount ASC, bid_time ASC 
          LIMIT 1
        `, [auctionId]);

        if (nextBestBid && nextBestBid.length > 0) {
          // Set new winning bid
          await conn.query(
            'UPDATE bids SET is_winning = 1 WHERE id = ?',
            [nextBestBid[0].id]
          );
          
          // Update auction current price
          await conn.query(
            'UPDATE auctions SET current_price = ? WHERE id = ?',
            [nextBestBid[0].amount, auctionId]
          );
        } else {
          // No other bids, reset to starting price
          const [auction] = await conn.query(
            'SELECT decremental_value FROM auctions WHERE id = ?',
            [auctionId]
          );
          
          if (auction && auction.length > 0) {
            await conn.query(
              'UPDATE auctions SET current_price = ? WHERE id = ?',
              [auction[0].decremental_value, auctionId]
            );
          }
        }
      }

      await conn.commit();
      
      res.json({
        success: true,
        message: 'Pre-bid rejected and deleted successfully'
      });

    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

  } catch (error) {
    console.error('❌ Reject pre-bid error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// reuse the admin logic: return only active/approved suppliers
// controllers/auctionController.js  (last lines)
exports.getApprovedUsers = async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT phone_number, company_name, person_name
       FROM   users
       WHERE  is_active = 1
         AND  status    = 'approved'
       ORDER  BY company_name, person_name`
    );
    res.json(rows);
  } catch (e) {
    console.error('❌ getApprovedUsers:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
