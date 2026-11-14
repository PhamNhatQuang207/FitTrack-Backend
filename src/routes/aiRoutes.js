const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { aiChatLimiter } = require('../middleware/rateLimiter');
const {
  chatWithAi,
  getConversations,
  getConversationById,
  deleteConversation,
  getMemories,
  deleteMemoryById,
  applyDraftPlan,
  getMcpKeyStatus,
  generateMcpKey,
  revokeMcpKey
} = require('../controllers/aiController');

router.use(authMiddleware);

router.post('/chat', aiChatLimiter, chatWithAi);
router.get('/conversations', getConversations);
router.get('/conversations/:id', getConversationById);
router.delete('/conversations/:id', deleteConversation);
router.post('/conversations/:id/messages/:messageId/apply-plan', applyDraftPlan);

router.get('/memories', getMemories);
router.delete('/memories/:id', deleteMemoryById);

router.get('/mcp-key', getMcpKeyStatus);
router.post('/mcp-key', generateMcpKey);
router.delete('/mcp-key', revokeMcpKey);

module.exports = router;
