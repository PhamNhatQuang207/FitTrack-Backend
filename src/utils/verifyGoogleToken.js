const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const getAllowedAudiences = () => {
  const audiences = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    ...(process.env.GOOGLE_CLIENT_IDS ? process.env.GOOGLE_CLIENT_IDS.split(',') : []),
  ]
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean);

  return [...new Set(audiences)];
};

const verifyGoogleToken = async (idToken) => {
  const audiences = getAllowedAudiences();
  if (audiences.length === 0) {
    throw new Error('Google OAuth client ID is not configured');
  }

  const ticket = await client.verifyIdToken({
    idToken,
    audience: audiences.length === 1 ? audiences[0] : audiences,
  });
  return ticket.getPayload();
};

verifyGoogleToken.getAllowedAudiences = getAllowedAudiences;

module.exports = verifyGoogleToken;
