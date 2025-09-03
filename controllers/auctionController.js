const Auction = require('../models/Auction');
const Bid = require('../models/Bid');
const AuctionParticipant = require('../models/AuctionParticipant');
const AuctionDocument = require('../models/AuctionDocument');
const User = require('../models/User');
const { sendSMS } = require('../utils/smsService');
const db = require('../db');

exports.createAuction = async (req, res) => {
  try {
    const {
      title,
      description,
      auction_date,
      start_time,
      duration,
      currency,
      base_price,
      decremental_value,
      pre_bid_allowed = true,
      participants,
      send_invitations = true
    } = req.body;

    if (!title || !auction_date || !start_time || !duration || !base_price) {
      return res.status(400).json({
        success: false,
        message: 'Title, date, start time, duration, and base price are required'
      });
    }

    const created_by = req.user.userId;

    const auctionId = await Auction.create({
      title,
      description,
      auction_date,
      start_time,
      duration: parseInt(duration) * 60,
      currency: currency || 'INR',
      base_price: parseFloat(base_price),
      decremental_value: decremental_value ? parseFloat(decremental_value) : 0,
      pre_bid_allowed: pre_bid_allowed === 'true' || pre_bid_allowed === true,
      created_by
    });

    let participantList = [];
    let smsCount = 0;
    let smsFailures = [];
    
    if (participants) {
      participantList = Array.isArray(participants) ? participants : [participants];
      participantList = [...new Set(participantList)].filter(p => p);

      if (participantList.length > 0) {
        const participantData = participantList.map(phone => ({
          user_id: null,
          phone_number: phone
        }));

        await AuctionParticipant.addMultiple(auctionId, participantData);

        if (send_invitations === 'true' || send_invitations === true) {
          try {
            const auction = await Auction.findById(auctionId);
            
            // Create a shorter, SMS-friendly message
            const auctionDate = new Date(auction.auction_date).toLocaleDateString('en-IN');
            const message = `Join "${auction.title}" auction on ${auctionDate} at ${auction.start_time}. Website: https://yourauctionapp.com`;

            console.log(`📨 Preparing to send ${participantList.length} invitation(s)`);

            // Send SMS to each participant with better error handling
            for (const participant of participantList) {
              try {
                console.log(`📤 Sending invitation to: ${participant}`);
                
                // ✅ Use transactional SMS for now (set isPromotional = false)
                await sendSMS(participant, message, true); // true = promotional
                
                console.log(`✅ Successfully sent to: ${participant}`);
                smsCount++;
              } catch (smsError) {
                console.error(`❌ Failed to send to ${participant}:`, smsError.message);
                smsFailures.push({
                  participant: participant,
                  error: smsError.message
                });
                
                // Continue with other participants even if one fails
                continue;
              }
              
              // Add a small delay between messages
              await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Log summary
            if (smsFailures.length > 0) {
              console.warn(`⚠️ ${smsFailures.length} SMS failed to send:`);
              smsFailures.forEach(failure => {
                console.warn(`   - ${failure.participant}: ${failure.error}`);
              });
            }

          } catch (smsError) {
            console.error('❌ Failed to process invitation SMS:', smsError);
            // Continue even if SMS processing fails
          }
        }
      }
    }

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await AuctionDocument.add({
          auction_id: auctionId,
          file_name: file.originalname,
          file_path: file.path,
          file_type: file.mimetype
        });
      }
    }

    const auction = await Auction.findById(auctionId);

    // Prepare response message
    let responseMessage = `Auction created successfully with ${participantList.length} participant(s)`;
    if (smsCount > 0) {
      responseMessage += ` and ${smsCount} invitation(s) sent`;
    }
    if (smsFailures.length > 0) {
      responseMessage += `, ${smsFailures.length} invitation(s) failed`;
    }

    res.status(201).json({
      success: true,
      message: responseMessage,
      auction,
      smsResults: {
        totalParticipants: participantList.length,
        successfulSMS: smsCount,
        failedSMS: smsFailures.length,
        failures: smsFailures
      }
    });

  } catch (error) {
    console.error('❌ Create auction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
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

    // Get auction details with creator information (added email & company_address)
    const [auctions] = await db.query(`
      SELECT a.*, 
             u.company_name as creator_company, 
             u.person_name as creator_name,
             u.email as creator_email,
             u.company_address as creator_address
      FROM auctions a 
      LEFT JOIN users u ON a.created_by = u.id 
      WHERE a.id = ?
    `, [id]);

    const auction = auctions[0];
    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    // Get participants, documents, and bids
    const participants = await AuctionParticipant.findByAuction(id);
    const documents = await AuctionDocument.findByAuction(id);
    const bids = await Bid.findByAuction(id);

    // Format date for display
    const auctionDate = new Date(auction.auction_date);
    const formattedDate = auctionDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    // Create the formatted response
    const response = {
      success: true,
      auction: {
        "auction_no": `AUC${auction.id.toString().padStart(3, '0')}`,
        "status": auction.status.toUpperCase(),
        "auctioneer_details": {
          "company_name": auction.creator_company || "Unknown Company",
          "person_name": auction.creator_name || "Unknown Person",
          "email": auction.creator_email || "Unknown Email",
          "company_address": auction.creator_address || "Unknown Address"
        },
        "auction_information": {
          "auction_date": formattedDate,
          "start_time": auction.start_time,
          "duration": `${auction.duration / 60} minutes`,
          "currency": auction.currency,
          "open_to_all": auction.open_to_all ? "Yes" : "No",
          "pre_bid_allowed": auction.pre_bid_allowed ? "Yes" : "No",
          "decremental_value": auction.decremental_value > 0 ? `INR ${auction.decremental_value}` : "N/A",
          "base_price": `INR ${auction.base_price}`,
          "current_price": `INR ${auction.current_price}`
        },
        "description": auction.description,
        "participants": {
          "total": participants.length,
          "list": participants.length > 0 ? participants : "No participants registered"
        },
        "bid_history": bids,
        "documents": documents
      }
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Get auction details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

exports.getLiveAuctions = async (req, res) => {
  try {
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

    // ✅ Always normalize auction_id
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

    // ✅ Normalize status check
    if (auction.status.toLowerCase() !== 'upcoming') {
      return res.status(400).json({
        success: false,
        message: 'Auction is not upcoming'
      });
    }

    // ✅ Parse numbers (remove INR/commas)
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

    // ✅ Check auction type
    if (decrementalValue > 0 && bidAmount >= currentPrice) {
      return res.status(400).json({
        success: false,
        message: `Bid must be lower than current price (${currentPrice})`
      });
    }

    if (decrementalValue === 0 && bidAmount <= currentPrice) {
      return res.status(400).json({
        success: false,
        message: `Bid must be higher than current price (${currentPrice})`
      });
    }

    // ✅ Save bid
    const bidId = await Bid.create({
      auction_id: auctionId,
      user_id,
      amount: bidAmount
    });

    // ✅ Update auction
    await Auction.updateCurrentPrice(auctionId, bidAmount);
    await Bid.setWinningBid(bidId);

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
        bid_time: new Date()
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

    if (auction.created_by !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only auction creator can close the auction'
      });
    }

    const winningBid = await Bid.findWinningBid(id);
    const winnerId = winningBid ? winningBid.user_id : null;

    await Auction.updateStatus(id, 'completed', winnerId);
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

    if (auction.created_by !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only auction creator can add participants'
      });
    }

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
        const message = `Please submit Pre Bid on Auction Website to join Auction "${auction.title}" on ${auctionDate} at ${auction.start_time}. Website: https://yourauctionapp.com`;

        for (const participant of participantList) {
          try {
            await sendSMS(participant, message, true); // true = promotional
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
    const userId = req.user.userId;

    const auction = await Auction.findById(auction_id);
    if (!auction) {
      return res.status(404).json({
        success: false,
        message: 'Auction not found'
      });
    }

    if (auction.created_by !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only auction creator can view participants'
      });
    }

    const participants = await AuctionParticipant.findByAuction(auction_id);

    res.json({
      success: true,
      participants,
      count: participants.length
    });

  } catch (error) {
    console.error('❌ Get participants error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
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
    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'You are not invited to this auction'
      });
    }

    await AuctionParticipant.updateStatus(auction_id, phone_number, 'joined');

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

// exports.getUserDashboard = async (req, res) => {
//   try {
//     const userId = req.user.userId;
    
//     // Get created auctions count
//     const createdAuctions = await Auction.findByUser(userId);
    
//     // Get participated auctions count (through bids)
//     const [participation] = await db.query(
//       `SELECT COUNT(DISTINCT auction_id) as count 
//        FROM bids WHERE user_id = ?`,
//       [userId]
//     );
    
//     res.json({
//       success: true,
//       stats: {
//         created: createdAuctions.length,
//         participated: participation[0].count
//       }
//     });
//   } catch (error) {
//     console.error('❌ Get user dashboard error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// };

exports.getFilteredAuctions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, type, search } = req.query;
    
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
        access_type: auction.pre_bid_allowed ? 'Open to All' : 'Invited Only',
        auction_no: `AUC${auction.id.toString().padStart(3, '0')}`
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
    
    if (auction.created_by !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only auction creator can start the auction'
      });
    }
    
    if (auction.status !== 'upcoming') {
      return res.status(400).json({
        success: false,
        message: 'Only upcoming auctions can be started'
      });
    }
    
    // Update auction status to live
    await Auction.updateStatus(id, 'live');
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
    
    if (auction.created_by !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only auction creator can join as auctioneer'
      });
    }
    
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
    
    if (auction.created_by !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only auction creator can download the report'
      });
    }
    
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
      ['Date & Time:', `${auction.auction_date} at ${auction.start_time}`, 'Currency:', auction.currency],
      ['Base Price:', auction.base_price, 'Final Price:', auction.current_price],
      ['', '', '', ''],
      ['Participants:', '', '', ''],
      ['Name', 'Phone', 'Company', 'Status']
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

