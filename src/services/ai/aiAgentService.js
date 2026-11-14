const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createFitTrackMcpServer } = require('../../mcp/createFitTrackMcpServer');
const { createExecutionLoopGuard } = require('./guards/executionLoopGuard');
const { generateAgentTurn } = require('./geminiClient');
const { buildSystemPrompt } = require('./systemPrompt');

function sanitizeJsonSchemaForGemini(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const clone = Array.isArray(schema) ? [...schema] : { ...schema };
  delete clone.$schema;
  delete clone.additionalProperties;
  if (clone.properties && typeof clone.properties === 'object') {
    const nextProps = {};
    for (const [k, v] of Object.entries(clone.properties)) {
      nextProps[k] = sanitizeJsonSchemaForGemini(v);
    }
    clone.properties = nextProps;
  }
  if (clone.items) {
    clone.items = sanitizeJsonSchemaForGemini(clone.items);
  }
  return clone;
}

async function runAiChatTurn({ db, userId, historyMessages, userText, memories }) {
  const mcpServer = createFitTrackMcpServer({ db, userId: userId.toString() });
  const mcpClient = new Client({ name: 'fittrack-internal-agent', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    mcpServer.connect(serverTransport),
    mcpClient.connect(clientTransport)
  ]);

  const loopGuard = createExecutionLoopGuard();
  let latestDraftPlan = null;
  let memoriesUpdated = false;

  try {
    const { tools: mcpTools } = await mcpClient.listTools();
    const geminiTools = mcpTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: sanitizeJsonSchemaForGemini(t.inputSchema)
    }));

    const contents = [
      ...historyMessages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }]
      })),
      {
        role: 'user',
        parts: [{ text: userText }]
      }
    ];

    const systemInstruction = buildSystemPrompt(memories);
    let finalAssistantText = '';

    while (true) {
      const stepCheck = loopGuard.canStep();
      if (!stepCheck.ok) {
        if (!finalAssistantText) {
          finalAssistantText =
            'Mình đã tổng hợp thông tin từ dữ liệu tập luyện của bạn. Bạn kiểm tra kết quả bên dưới nhé!';
        }
        break;
      }

      const turn = await generateAgentTurn({
        systemInstruction,
        contents,
        tools: geminiTools
      });

      const functionCalls = turn.functionCalls || [];
      if (functionCalls.length === 0) {
        finalAssistantText =
          (turn.text || '').trim() ||
          'Mình đã xử lý yêu cầu của bạn. Bạn xem chi tiết bên dưới nhé!';
        break;
      }

      // Append model functionCall turn
      contents.push({
        role: 'model',
        parts: functionCalls.map((fc) => ({
          functionCall: {
            name: fc.name,
            args: fc.args || {}
          }
        }))
      });

      const responseParts = [];
      for (const fc of functionCalls) {
        const callName = fc.name;
        const callArgs = fc.args || {};

        const dupCheck = loopGuard.checkToolCall(callName, callArgs);
        if (!dupCheck.ok) {
          loopGuard.recordToolResult(callName, true);
          responseParts.push({
            functionResponse: {
              name: callName,
              response: { error: dupCheck.reason }
            }
          });
          continue;
        }

        const mcpResult = await mcpClient.callTool({
          name: callName,
          arguments: callArgs
        });

        const isError = Boolean(mcpResult.isError);
        loopGuard.recordToolResult(callName, isError);

        let parsedPayload = {};
        try {
          parsedPayload = JSON.parse(mcpResult.content?.[0]?.text || '{}');
        } catch {
          parsedPayload = { raw: mcpResult.content?.[0]?.text || '' };
        }

        if (!isError && parsedPayload.draftPlan) {
          latestDraftPlan = parsedPayload.draftPlan;
        }
        if (
          !isError &&
          (callName === 'save_user_memory' || callName === 'delete_user_memory')
        ) {
          memoriesUpdated = true;
        }

        responseParts.push({
          functionResponse: {
            name: callName,
            response: parsedPayload
          }
        });
      }

      contents.push({
        role: 'user',
        parts: responseParts
      });
    }

    return {
      text: finalAssistantText,
      toolTrace: loopGuard.getToolTrace(),
      draftPlan: latestDraftPlan,
      memoriesUpdated
    };
  } finally {
    await mcpClient.close().catch(() => {});
    await mcpServer.close().catch(() => {});
  }
}

module.exports = {
  runAiChatTurn
};
