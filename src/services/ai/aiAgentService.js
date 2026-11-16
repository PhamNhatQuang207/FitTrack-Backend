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

async function runAiChatTurn({ db, userId, historyMessages, userText, memories, lang = 'en' }) {
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
  const collectedCitations = [];
  const citationsByChunkId = new Map();

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

    const systemInstruction = buildSystemPrompt(memories, lang);
    let finalAssistantText = '';

    while (true) {
      const stepCheck = loopGuard.canStep();
      if (!stepCheck.ok) {
        if (!finalAssistantText) {
          finalAssistantText =
            lang === 'vi'
              ? 'Mình đã tổng hợp thông tin từ dữ liệu tập luyện của bạn. Vui lòng xem kết quả bên dưới!'
              : 'I have compiled the information from your training data. Please check the results below!';
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
          (lang === 'vi'
            ? 'Mình đã xử lý yêu cầu của bạn. Vui lòng kiểm tra chi tiết bên dưới!'
            : 'I have processed your request. Please check the details below!');
        break;
      }

      // Append model functionCall turn — preserve rawCandidates[0].content so
      // Gemini 3.x thought_signature and thought parts remain intact across tool rounds
      const rawModelContent = turn.rawCandidates?.[0]?.content;
      if (rawModelContent && Array.isArray(rawModelContent.parts) && rawModelContent.parts.length > 0) {
        contents.push({
          role: rawModelContent.role || 'model',
          parts: rawModelContent.parts
        });
      } else {
        contents.push({
          role: 'model',
          parts: functionCalls.map((fc) => ({
            functionCall: {
              name: fc.name,
              args: fc.args || {}
            }
          }))
        });
      }

      const responseParts = [];
      for (const fc of functionCalls) {
        const callName = fc.name;
        const callArgs = fc.args || {};

        const dupCheck = loopGuard.checkToolCall(callName, callArgs);
        if (!dupCheck.ok) {
          loopGuard.recordToolResult(callName, true);
          responseParts.push({
            functionResponse: {
              ...(fc.id ? { id: fc.id } : {}),
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
          const parsed = JSON.parse(mcpResult.content?.[0]?.text || '{}');
          parsedPayload =
            typeof parsed === 'object' && parsed !== null ? parsed : { result: parsed };
        } catch {
          parsedPayload = { raw: mcpResult.content?.[0]?.text || '' };
        }

        if (!isError && parsedPayload.draftPlan) {
          latestDraftPlan = parsedPayload.draftPlan;
        }
        if (
          !isError &&
          callName === 'search_fitness_knowledge' &&
          Array.isArray(parsedPayload.citations)
        ) {
          parsedPayload.citations = parsedPayload.citations.map((item) => {
            if (!item || !item.chunkId) return item;
            let existing = citationsByChunkId.get(item.chunkId);
            if (!existing) {
              existing = {
                citationNumber: collectedCitations.length + 1,
                ...item
              };
              citationsByChunkId.set(item.chunkId, existing);
              collectedCitations.push(existing);
            }
            return existing;
          });
        }
        if (
          !isError &&
          (callName === 'save_user_memory' || callName === 'delete_user_memory')
        ) {
          memoriesUpdated = true;
        }

        responseParts.push({
          functionResponse: {
            ...(fc.id ? { id: fc.id } : {}),
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
      citations: collectedCitations,
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
