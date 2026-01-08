const sendEmailSMTP = require('./sendEmail');
const sendEmailResend = require('./sendEmailResend');

/**
 * Smart email sender that chooses the right service based on environment
 * - Local development: Uses Gmail SMTP (no restrictions)
 * - Production (Render): Uses Resend (SMTP is blocked)
 */
const sendEmailSmart = async (options) => {
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction) {
        // Use Resend in production (SMTP blocked on Render)
        console.log('📧 Using Resend for email delivery (production)');
        return await sendEmailResend(options);
    } else {
        // Use Gmail SMTP for local development (no Resend test restrictions)
        console.log('📧 Using Gmail SMTP for email delivery (development)');
        try {
            return await sendEmailSMTP(options);
        } catch (error) {
            console.warn('⚠️  Gmail SMTP failed, email not sent (development mode)');
            console.log('To:', options.to);
            console.log('Subject:', options.subject);
            return { id: 'dev-mode-skipped' };
        }
    }
};

module.exports = sendEmailSmart;
