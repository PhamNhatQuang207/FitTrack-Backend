const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send email using Resend
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} options.text - Plain text content (optional)
 */
const sendEmail = async (options) => {
    try {
        const result = await resend.emails.send({
            from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
            to: options.to,
            subject: options.subject,
            html: options.html,
        });
        
        console.log('✅ Email sent successfully via Resend:', result.id);
        return result;
    } catch (error) {
        console.error('❌ Resend error:', error);
        throw new Error('Failed to send email');
    }
};

module.exports = sendEmail;
