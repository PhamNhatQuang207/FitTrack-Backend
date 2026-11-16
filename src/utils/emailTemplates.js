function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLang(lang) {
  return lang === 'vi' ? 'vi' : 'en';
}

function renderEmailHtml({
  headerSubtitle,
  greeting,
  body,
  actionUrl,
  ctaLabel,
  copyLabel,
  noticeBg,
  noticeBorder,
  noticeColor,
  noticeLabel,
  noticeText,
}) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f3f4f6;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
        <div style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 40px 20px; text-align: center;">
          <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: bold;">🏋️ FitTrack</h1>
          <p style="margin: 10px 0 0 0; color: #e0e7ff; font-size: 16px;">${headerSubtitle}</p>
        </div>
        <div style="padding: 40px 30px;">
          <h2 style="margin: 0 0 20px 0; color: #1f2937; font-size: 24px;">${greeting}</h2>
          <p style="margin: 0 0 20px 0; color: #4b5563; font-size: 16px; line-height: 1.6;">
            ${body}
          </p>
          <div style="text-align: center; margin: 40px 0;">
            <a href="${actionUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              ${ctaLabel}
            </a>
          </div>
          <div style="margin: 30px 0; padding: 20px; background-color: #f9fafb; border-radius: 8px; border-left: 4px solid #3b82f6;">
            <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;"><strong>${copyLabel}</strong></p>
            <p style="margin: 0; color: #3b82f6; font-size: 14px; word-break: break-all;">${actionUrl}</p>
          </div>
          <div style="margin: 30px 0; padding: 15px; background-color: ${noticeBg}; border-radius: 8px; border-left: 4px solid ${noticeBorder};">
            <p style="margin: 0; color: ${noticeColor}; font-size: 14px;">⏱️ <strong>${noticeLabel}</strong> ${noticeText}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Build bilingual verification email payload (subject, html, text).
 */
function buildVerificationEmail({ name, verifyUrl, lang = 'en' }) {
  const isVi = normalizeLang(lang) === 'vi';
  const rawName = name || (isVi ? 'bạn' : 'there');
  const safeName = escapeHtml(rawName);

  const copy = isVi
    ? {
        subject: '🎯 Chào mừng đến với FitTrack - Xác thực Email của bạn',
        headerSubtitle: 'Hành trình thể hình của bạn bắt đầu tại đây',
        greeting: `Xin chào, ${safeName}! 👋`,
        body: 'Cảm ơn bạn đã tham gia FitTrack! Vui lòng xác thực địa chỉ email bằng cách nhấn vào nút bên dưới:',
        ctaLabel: 'Xác thực địa chỉ Email',
        copyLabel: 'Hoặc sao chép liên kết này:',
        noticeLabel: 'Lưu ý:',
        noticeText: 'Liên kết xác thực này sẽ hết hạn sau 24 giờ.',
        text: `Chào mừng đến với FitTrack, ${rawName}! Vui lòng xác thực email tại: ${verifyUrl}\n\nLiên kết này sẽ hết hạn sau 24 giờ.`,
      }
    : {
        subject: '🎯 Welcome to FitTrack - Verify Your Email',
        headerSubtitle: 'Your Fitness Journey Starts Here',
        greeting: `Welcome, ${safeName}! 👋`,
        body: 'Thank you for joining FitTrack! Please verify your email address by clicking the button below:',
        ctaLabel: 'Verify Email Address',
        copyLabel: 'Or copy and paste this link:',
        noticeLabel: 'Important:',
        noticeText: 'This verification link will expire in 24 hours.',
        text: `Welcome to FitTrack, ${rawName}! Please verify your email by visiting: ${verifyUrl}\n\nThis link will expire in 24 hours.`,
      };

  return {
    subject: copy.subject,
    html: renderEmailHtml({
      ...copy,
      actionUrl: verifyUrl,
      noticeBg: '#fef3c7',
      noticeBorder: '#f59e0b',
      noticeColor: '#92400e',
    }),
    text: copy.text,
  };
}

/**
 * Build bilingual password reset email payload (subject, html, text).
 */
function buildResetPasswordEmail({ name, resetUrl, lang = 'en' }) {
  const isVi = normalizeLang(lang) === 'vi';
  const rawName = name || (isVi ? 'bạn' : 'there');
  const safeName = escapeHtml(rawName);

  const copy = isVi
    ? {
        subject: '🔒 FitTrack - Yêu cầu đặt lại mật khẩu',
        headerSubtitle: 'Yêu cầu đặt lại mật khẩu',
        greeting: `Xin chào, ${safeName}!`,
        body: 'Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản FitTrack. Nhấn vào nút bên dưới để tạo mật khẩu mới:',
        ctaLabel: 'Đặt lại mật khẩu',
        copyLabel: 'Hoặc sao chép liên kết này:',
        noticeLabel: 'Lưu ý:',
        noticeText: 'Liên kết đặt lại mật khẩu này sẽ hết hạn sau 1 giờ.',
        text: `Xin chào ${rawName},\n\nĐặt lại mật khẩu FitTrack của bạn tại: ${resetUrl}\n\nLiên kết này sẽ hết hạn sau 1 giờ.`,
      }
    : {
        subject: '🔒 FitTrack - Password Reset Request',
        headerSubtitle: 'Password Reset Request',
        greeting: `Hi, ${safeName}!`,
        body: 'You requested to reset your password for your FitTrack account. Click the button below to create a new password:',
        ctaLabel: 'Reset Password',
        copyLabel: 'Or copy and paste this link:',
        noticeLabel: 'Important:',
        noticeText: 'This password reset link will expire in 1 hour.',
        text: `Password Reset Request\n\nHi ${rawName},\n\nPlease visit the following link to create a new password:\n\n${resetUrl}\n\nThis link will expire in 1 hour.`,
      };

  return {
    subject: copy.subject,
    html: renderEmailHtml({
      ...copy,
      actionUrl: resetUrl,
      noticeBg: '#fee2e2',
      noticeBorder: '#dc2626',
      noticeColor: '#7f1d1d',
    }),
    text: copy.text,
  };
}

module.exports = { buildVerificationEmail, buildResetPasswordEmail };
