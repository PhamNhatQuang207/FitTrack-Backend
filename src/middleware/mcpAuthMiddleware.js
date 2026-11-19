const crypto = require('crypto');
const { getDb } = require('../config/db');
const authMiddleware = require('./authMiddleware');

const mcpAuthMiddleware = async (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1]?.trim();
    } else if (req.headers['x-mcp-api-key']) {
      const raw = req.headers['x-mcp-api-key'];
      token = typeof raw === 'string' ? raw.trim() : null;
    }

    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (token.startsWith('ftk_')) {
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const db = getDb();
      const user = await db.collection('users').findOne(
        { mcpApiKeyHash: hash },
        { projection: { _id: 1 } }
      );

      if (!user) {
        return res.status(401).json({ message: 'Invalid or revoked MCP API key' });
      }

      req.userId = user._id.toString();
      return next();
    }

    return authMiddleware(req, res, next);
  } catch (error) {
    console.error('[mcpAuthMiddleware]', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = mcpAuthMiddleware;
