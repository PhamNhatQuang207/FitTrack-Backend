const {
  StreamableHTTPServerTransport
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { getDb } = require('../config/db');
const { createFitTrackMcpServer } = require('./createFitTrackMcpServer');

async function mcpHttpHandler(req, res) {
  try {
    const db = getDb();
    const mcpServer = createFitTrackMcpServer({
      db,
      userId: req.userId
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    res.on('close', () => {
      transport.close().catch(() => {});
      mcpServer.close().catch(() => {});
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[mcpHttpHandler]', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal MCP server error' },
        id: null
      });
    }
  }
}

module.exports = { mcpHttpHandler };
