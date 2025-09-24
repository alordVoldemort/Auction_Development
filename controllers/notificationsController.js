const db = require('../db');
const { formatInTimeZone } = require('date-fns-tz');
const TZ = 'Asia/Kolkata';

exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const [rows] = await db.query(
      `SELECT n.id, n.type, n.auction_id, a.title auction_title,
              n.message, n.is_read, n.created_at
       FROM notifications n
       LEFT JOIN auctions a ON a.id = n.auction_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [userId]
    );
    const [[{ unread }]] = await db.query(
      'SELECT COUNT(*) unread FROM notifications WHERE user_id = ? AND is_read = 0',
      [userId]
    );
    res.json({
      success: true,
      notifications: rows.map(r => ({
        id: r.id,
        type: r.type,
        auction_id: r.auction_id,
        auction_title: r.auction_title,
        message: r.message,
        is_read: Boolean(r.is_read),
        created_at: formatInTimeZone(r.created_at, TZ, 'yyyy-MM-dd HH:mm:ss')
      })),
      unreadCount: unread
    });
  } catch (e) {
    console.error('❌ getMyNotifications:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getParticipantNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const auctionId = parseInt(req.params.auctionId, 10);
    if (isNaN(auctionId)) return res.status(400).json({ success: false, message: 'Invalid auction ID' });

    const [owner] = await db.query(
      'SELECT 1 FROM auctions WHERE id = ? AND created_by = ?',
      [auctionId, userId]
    );
    if (!owner.length) return res.status(403).json({ success: false, message: 'Not authorised' });

    const [rows] = await db.query(
      `SELECT n.id, n.user_id, u.person_name, u.company_name, u.phone_number,
              n.message, n.is_read, n.created_at
       FROM notifications n
       JOIN users u ON u.id = n.user_id
       WHERE n.auction_id = ? AND n.type = 'invitation'
       ORDER BY n.created_at DESC`,
      [auctionId]
    );
    res.json({
      success: true,
      notifications: rows.map(r => ({
        id: r.id,
        user_id: r.user_id,
        person_name: r.person_name,
        company_name: r.company_name,
        phone_number: r.phone_number,
        message: r.message,
        is_read: Boolean(r.is_read),
        created_at: formatInTimeZone(r.created_at, TZ, 'yyyy-MM-dd HH:mm:ss')
      }))
    });
  } catch (e) {
    console.error('❌ getParticipantNotifications:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const nid    = parseInt(req.params.id, 10);
    await db.query(
      `UPDATE notifications
       SET is_read = 1
       WHERE id = ? AND user_id = ?`,
      [nid, userId]
    );
    res.status(204).send();
  } catch (e) {
    console.error('❌ markAsRead:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

