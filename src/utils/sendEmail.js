const nodemailer = require('nodemailer');

/**
 * Send email using nodemailer
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} options.text - Plain text content (optional)
 */
const sendEmail = async (options) => {
    try {
        // Create transporter with better configuration for deployment
        const transporterConfig = {
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.EMAIL_PORT) || 587,
            secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            },
            // Add timeout and connection settings for better reliability
            connectionTimeout: 10000, // 10 seconds
            greetingTimeout: 5000,
            socketTimeout: 10000,
            // For debugging
            logger: process.env.NODE_ENV === 'production' ? false : true,
            debug: process.env.NODE_ENV !== 'production'
        };

        const transporter = nodemailer.createTransport(transporterConfig);

        // Email options
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'FitTrack <noreply@fittrack.com>',
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html
        };

        // Send email
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw new Error('Failed to send email');
    }
};

module.exports = sendEmail;
