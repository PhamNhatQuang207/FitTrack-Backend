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
        // Check if API key is configured
        if (!process.env.RESEND_API_KEY) {
            console.error('❌ RESEND_API_KEY is not configured in environment variables');
            throw new Error('Resend API key is missing');
        }

        const result = await resend.emails.send({
            from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
            to: options.to,
            subject: options.subject,
            html: options.html,
        });
        
        // Check if result is valid
        if (!result || !result.data) {
            console.error('❌ Resend returned invalid response:', result);
            throw new Error('Invalid response from Resend API');
        }
        
        console.log('✅ Email sent successfully via Resend');
        console.log('📧 Email ID:', result.data.id);
        console.log('📬 Sent to:', options.to);
        return result;
    } catch (error) {
        console.error('❌ Resend error:', error.message);
        if (error.name === 'ResendError') {
            console.error('🔑 API Key issue - check your RESEND_API_KEY');
        }
        throw new Error('Failed to send email: ' + error.message);
    }
};

module.exports = sendEmail;
