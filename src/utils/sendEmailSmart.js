const sendEmailSMTP = require('./sendEmail');
const sendEmailResend = require('./sendEmailResend');

/**
 * Smart email sender that chooses the right service based on environment
 * Control via EMAIL_SERVICE env var: 'resend' or 'smtp'
 * Default: 'resend' in production, 'smtp' in development
 */
const sendEmailSmart = async (options) => {
    const emailService = process.env.EMAIL_SERVICE; // 'resend' or 'smtp'
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Use explicit EMAIL_SERVICE if set, otherwise auto-detect
    const useResend = emailService === 'resend' || (!emailService && isProduction);
    
    if (useResend) {
        console.log('📧 Using Resend for email delivery');
        return await sendEmailResend(options);
    } else {
        console.log('📧 Using Gmail SMTP for email delivery');
        try {
            return await sendEmailSMTP(options);
        } catch (error) {
            console.warn('⚠️  Gmail SMTP failed:', error.message);
            console.log('Email preview - To:', options.to, 'Subject:', options.subject);
            return { id: 'dev-mode-skipped' };
        }
    }
};

module.exports = sendEmailSmart;
