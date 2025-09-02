const sgMail = require('@sendgrid/mail');

// Initialize SendGrid with your API Key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

class EmailService {
  /**
   * Send an auction invitation email
   */
  static async sendAuctionInvitation(toEmail, auction, invitationLink) {
    // Format the date and time for display
    const auctionDate = new Date(auction.auction_date).toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const startTime = new Date(`1970-01-01T${auction.start_time}Z`).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    // Create the email content
    const msg = {
      to: toEmail,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL,
        name: process.env.SENDGRID_FROM_NAME
      },
      subject: `You're Invited: ${auction.title}`,
      html: this.generateInvitationTemplate(auction, auctionDate, startTime, invitationLink),
      text: this.generateTextVersion(auction, auctionDate, startTime, invitationLink),
      trackingSettings: {
        clickTracking: { enable: true },
        openTracking: { enable: true }
      }
    };

    try {
      console.log(`📧 Preparing to send email invitation to: ${toEmail}`);
      const response = await sgMail.send(msg);
      
      console.log(`✅ Email sent successfully to: ${toEmail}`);
      return {
        success: true,
        messageId: response[0]?.headers['x-message-id'],
        recipient: toEmail
      };
    } catch (error) {
      console.error(`❌ Failed to send email to ${toEmail}:`, error.response?.body?.errors || error.message);
      
      return {
        success: false,
        error: error.response?.body?.errors || error.message,
        recipient: toEmail
      };
    }
  }

  /**
   * Generate HTML template for the invitation email
   */
  static generateInvitationTemplate(auction, formattedDate, formattedTime, invitationLink) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .details { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #667eea; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>You're Invited to an Auction!</h1>
            <p>Don't miss your chance to bid on unique items</p>
          </div>
          
          <div class="content">
            <h2>${auction.title}</h2>
            <p>${auction.description || 'Join us for an exciting auction event!'}</p>
            
            <div class="details">
              <h3>📅 Auction Details</h3>
              <p><strong>Date:</strong> ${formattedDate}</p>
              <p><strong>Time:</strong> ${formattedTime}</p>
              <p><strong>Starting Bid:</strong> ${auction.currency} ${auction.base_price}</p>
            </div>
            
            <p>Ready to participate? Click the button below to join the auction:</p>
            <center>
              <a href="${invitationLink}" class="button">Join Auction Now</a>
            </center>
            
            <p>Or copy and paste this link into your browser:<br>
            <a href="${invitationLink}">${invitationLink}</a></p>
            
            <div class="footer">
              <p>This invitation was sent to you by ${process.env.SENDGRID_FROM_NAME}.</p>
              <p>If you believe you received this email in error, please ignore it.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate plain text version for the email
   */
  static generateTextVersion(auction, formattedDate, formattedTime, invitationLink) {
    return `
You're Invited to an Auction!

${auction.title}
${auction.description || 'Join us for an exciting auction event!'}

Auction Details:
- Date: ${formattedDate}
- Time: ${formattedTime}
- Starting Bid: ${auction.currency} ${auction.base_price}

To participate in this auction, click the link below:
${invitationLink}

This invitation was sent to you by ${process.env.SENDGRID_FROM_NAME}.
If you believe you received this email in error, please ignore it.
    `;
  }
}

module.exports = EmailService;