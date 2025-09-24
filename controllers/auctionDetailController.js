const db = require('../db'); // your MySQL connection

// Get auction details by ID
exports.getAuctionDetails = async (req, res) => {
    const auctionId = req.params.id;

    try {
        const [rows] = await db.execute(
            `SELECT 
          id,
          title,
          description,
          auction_date,
          start_time,
          DATE_ADD(TIMESTAMP(auction_date, start_time), INTERVAL duration MINUTE) AS end_time,
          pre_bid_allowed,
          currency,
          decremental_value
       FROM auctions
       WHERE id = ?`,
            [auctionId]
        );

        if (rows.length === 0) return res.status(404).json({ message: 'Auction not found' });

        // Format response for frontend
        const auction = rows[0];
        auction.open_to_all = auction.pre_bid_allowed ? 'Yes' : 'No';
        delete auction.pre_bid_allowed;

        res.json(auction);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get simplified bid summary for an auction
exports.getAuctionBids = async (req, res) => {
    const auctionId = req.params.id;

    try {
        // Fetch highest bid per participant (company)
        const [bids] = await db.execute(
            `SELECT u.company_name,
              MAX(b.amount) AS final_bid
       FROM bids b
       JOIN users u ON b.user_id = u.id
       WHERE b.auction_id = ?
       GROUP BY u.company_name
       ORDER BY final_bid DESC`,
            [auctionId]
        );

        // Assign rank manually in JS
        let rank = 1;
        const rankedBids = bids.map((b, index) => {
            if (index > 0 && b.final_bid === bids[index - 1].final_bid) {
                // same rank as previous
                b.rank = rankedBids[index - 1].rank;
            } else {
                b.rank = rank;
            }
            rank++;
            return b;
        });

        res.json({ auctionId, bids: rankedBids });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get auction report by ID
exports.getAuctionReport = async (req, res) => {
    const auctionId = parseInt(req.params.id);

    if (!auctionId || isNaN(auctionId) || auctionId <= 0) {
        return res.status(400).json({ 
            message: "Invalid auction ID",
            details: "Auction ID must be a positive integer"
        });
    }

    try {
        console.log(`Fetching auction report for ID: ${auctionId}`);

        // 1. Fetch auction details
        const [auctionResults] = await db.query(
            `SELECT 
                id, 
                title, 
                description, 
                auction_date, 
                start_time, 
                end_time,
                duration,
                currency,
                current_price,
                decremental_value,
                pre_bid_allowed,
                status,
                created_by,
                winner_id,
                created_at,
                updated_at,
                winner_notified
            FROM auctions 
            WHERE id = ?`,
            [auctionId]
        );

        if (!auctionResults || auctionResults.length === 0) {
            return res.status(404).json({ 
                message: "Auction not found",
                auctionId: auctionId
            });
        }

        const auction = auctionResults[0];

        // Format date as DD-MM-YYYY
        const formatDate = (dateString) => {
            if (!dateString) return null;
            const date = new Date(dateString);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}-${month}-${year}`; // Returns "24-09-2025"
        };

        // Format time as HH:MM:SS (keep as is)
        const formatTime = (timeString) => {
            if (!timeString) return null;
            if (typeof timeString === 'string' && timeString.match(/^\d{2}:\d{2}:\d{2}$/)) {
                return timeString;
            }
            const date = new Date(timeString);
            return date.toTimeString().split(' ')[0];
        };

        // 2. Fetch bids summary
        let bids = [];
        try {
            const [bidResults] = await db.query(
                `SELECT 
                    u.company_name,
                    u.id as user_id,
                    MIN(b.amount) AS pre_bid_offer,
                    MAX(b.amount) AS final_bid_offer,
                    COUNT(b.id) AS total_bids,
                    RANK() OVER (ORDER BY MAX(b.amount) DESC) AS bid_rank
                FROM bids b
                JOIN users u ON b.user_id = u.id
                WHERE b.auction_id = ?
                GROUP BY u.id, u.company_name
                ORDER BY bid_rank ASC`,
                [auctionId]
            );
            bids = bidResults || [];
        } catch (bidError) {
            console.warn("Error fetching bids:", bidError.message);
        }

        // 3. Prepare response with consistent date format
        const response = {
            success: true,
            auction: {
                ...auction,
                // Format dates as DD-MM-YYYY
                auction_date: formatDate(auction.auction_date), // Now returns "24-09-2025"
                start_time: formatTime(auction.start_time),     // Returns "13:26:00"
                end_time: formatTime(auction.end_time),         // Returns "15:26:00"
                pre_bid_allowed: Boolean(auction.pre_bid_allowed),
                
                // Add additional formatted fields like your other API
                formatted_start_time: formatTimeTo12Hour(auction.start_time), // "01:26 PM"
                formatted_end_time: formatTimeTo12Hour(auction.end_time),     // "03:26 PM"
                auction_no: `AUC${auction.id}`,
                
                // Add other fields that match your API structure
                open_to_all: auction.open_to_all || false,
                time_remaining: calculateTimeRemaining(auction.end_time),
                time_status: getTimeStatus(auction.start_time, auction.end_time),
                time_value: "",
                is_creator: req.user?.id === auction.created_by,
                has_joined: false,
                has_bid: bids.some(bid => bid.user_id === req.user?.id),
                
                // Add nested objects
                creator_info: await getCreatorInfo(auction.created_by),
                winner_info: auction.winner_id ? await getWinnerInfo(auction.winner_id) : null,
                participants: await getParticipants(auctionId),
                documents: await getDocuments(auctionId),
                bids: bids,
                statistics: {
                    total_participants: (await getParticipants(auctionId)).length,
                    total_bids: bids.reduce((sum, bid) => sum + (bid.total_bids || 0), 0),
                    active_participants: (await getParticipants(auctionId)).filter(p => p.status === 'joined').length,
                    highest_bid: bids.length > 0 ? bids[0].final_bid_offer : null,
                    lowest_bid: bids.length > 0 ? bids.reduce((min, bid) => 
                        parseFloat(bid.final_bid_offer) < parseFloat(min) ? bid.final_bid_offer : min, 
                        bids[0].final_bid_offer
                    ) : null
                }
            }
        };

        res.json(response);

    } catch (err) {
        console.error("Error fetching auction report:", err);
        res.status(500).json({ 
            success: false,
            message: "Internal server error",
            error: err.message
        });
    }
};

// Helper functions
function formatTimeTo12Hour(timeString) {
    if (!timeString) return "";
    
    const time = new Date(`2000-01-01T${timeString}`);
    return time.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
    });
}

function calculateTimeRemaining(endTime) {
    if (!endTime) return 0;
    
    const now = new Date();
    const end = new Date(`2000-01-01T${endTime}`);
    const diff = end - now;
    
    return Math.max(0, Math.floor(diff / 1000));
}

function getTimeStatus(startTime, endTime) {
    if (!startTime || !endTime) return "unknown";
    
    const now = new Date();
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);
    
    if (now < start) return "upcoming";
    if (now >= start && now <= end) return "live";
    return "completed";
}

// Additional data fetching functions
async function getCreatorInfo(userId) {
    try {
        const [results] = await db.query(
            `SELECT company_name, person_name, phone, email 
             FROM users 
             WHERE id = ?`,
            [userId]
        );
        return results[0] || null;
    } catch (error) {
        console.warn("Error fetching creator info:", error.message);
        return null;
    }
}

async function getWinnerInfo(userId) {
    try {
        const [results] = await db.query(
            `SELECT company_name, person_name, phone, email 
             FROM users 
             WHERE id = ?`,
            [userId]
        );
        return results[0] || null;
    } catch (error) {
        console.warn("Error fetching winner info:", error.message);
        return null;
    }
}

async function getParticipants(auctionId) {
    try {
        const [results] = await db.query(
            `SELECT 
                id,
                user_id,
                phone_number,
                status,
                invited_at,
                joined_at,
                person_name,
                company_name
             FROM auction_participants 
             WHERE auction_id = ?`,
            [auctionId]
        );
        return results || [];
    } catch (error) {
        console.warn("Error fetching participants:", error.message);
        return [];
    }
}

async function getDocuments(auctionId) {
    try {
        const [results] = await db.query(
            `SELECT 
                id,
                file_name,
                file_url,
                file_type,
                uploaded_at
             FROM auction_documents 
             WHERE auction_id = ?`,
            [auctionId]
        );
        return results || [];
    } catch (error) {
        console.warn("Error fetching documents:", error.message);
        return [];
    }
}

// Get all auctions for dropdown
exports.getAllAuctions = async (req, res) => {
  try {
    const userId = req.query.userId; // ?userId=123
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const query = `
      SELECT a.id, a.title, a.status, a.auction_date, a.start_time, 'created' as auction_type
      FROM auctions a WHERE a.created_by = ?
      UNION
      SELECT a.id, a.title, a.status, a.auction_date, a.start_time, 'participated' as auction_type
      FROM auctions a INNER JOIN bids b ON a.id = b.auction_id WHERE b.user_id = ?
      UNION
      SELECT a.id, a.title, a.status, a.auction_date, a.start_time, 'invited' as auction_type
      FROM auctions a INNER JOIN auction_participants ap ON a.id = ap.auction_id WHERE ap.user_id = ?
      ORDER BY auction_date DESC, start_time DESC
    `;

    const [auctions] = await db.query(query, [userId, userId, userId]);

    res.json({ success: true, auctions, count: auctions.length });
  } catch (err) {
    console.error("Error fetching auctions:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/////
