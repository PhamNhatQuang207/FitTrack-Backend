const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');

jest.mock('../../src/services/ai/geminiClient', () => ({
  generateAgentTurn: jest.fn()
}));

jest.mock('../../src/mcp/createFitTrackMcpServer', () => ({
  createFitTrackMcpServer: jest.fn()
}));

const { generateAgentTurn } = require('../../src/services/ai/geminiClient');
const { createFitTrackMcpServer } = require('../../src/mcp/createFitTrackMcpServer');
const {
  runAiChatTurn,
  isIncompleteToolNarration
} = require('../../src/services/ai/aiAgentService');

function buildStubMcpServer() {
  const server = new McpServer({ name: 'fittrack-test-mcp', version: '1.0.0' });
  server.tool(
    'search_fitness_knowledge',
    'Search sports science knowledge',
    { query: z.string() },
    async () => ({
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            count: 1,
            citations: [
              {
                chunkId: 'deload-safety#1',
                sourceId: 'deload-safety',
                title: 'Deloading and Safety Boundaries',
                section: 'Injury Boundaries',
                excerpt: 'Stop painful movements and reduce grip stress.'
              }
            ]
          })
        }
      ]
    })
  );
  return server;
}

describe('aiAgentService incomplete-turn recovery', () => {
  beforeEach(() => {
    generateAgentTurn.mockReset();
    createFitTrackMcpServer.mockReset();
    createFitTrackMcpServer.mockImplementation(() => buildStubMcpServer());
  });

  test('isIncompleteToolNarration catches dangling colon and tool announcement patterns', () => {
    expect(
      isIncompleteToolNarration(
        'Để giúp bạn hiểu rõ hơn, tôi xin phép tìm kiếm tài liệu từ cơ sở dữ liệu:',
        0
      )
    ).toBe(true);
    expect(isIncompleteToolNarration('Let me search the knowledge base...', 0)).toBe(true);
    expect(isIncompleteToolNarration('Câu trả lời hoàn chỉnh dành cho bạn.', 0)).toBe(false);
  });

  test('recovers when model stops after narrating tool intent ending with ":" and completes with tool citations', async () => {
    generateAgentTurn
      .mockResolvedValueOnce({
        functionCalls: [],
        text: 'Để giúp bạn hiểu rõ hơn và có hướng xử lý khoa học, tôi xin phép tìm kiếm tài liệu từ cơ sở dữ liệu khoa học tập luyện và phục hồi:',
        finishReason: 'STOP'
      })
      .mockResolvedValueOnce({
        functionCalls: [
          {
            name: 'search_fitness_knowledge',
            args: { query: 'forearm tendon pain deload training safety' }
          }
        ],
        text: '',
        finishReason: 'STOP'
      })
      .mockResolvedValueOnce({
        functionCalls: [],
        text: 'Bạn nên tạm dừng các bài tập gây đau và giảm tải cầm nắm [1].',
        finishReason: 'STOP'
      });

    const result = await runAiChatTurn({
      db: {},
      userId: '507f1f77bcf86cd799439011',
      historyMessages: [],
      userText: 'Tôi bị đau cẳng tay phải làm sao',
      memories: [],
      lang: 'vi'
    });

    expect(generateAgentTurn).toHaveBeenCalledTimes(3);
    expect(result.toolTrace).toEqual([{ name: 'search_fitness_knowledge', status: 'ok' }]);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({ citationNumber: 1, chunkId: 'deload-safety#1' });
    expect(result.text).toBe('Bạn nên tạm dừng các bài tập gây đau và giảm tải cầm nắm [1].');
  });

  test('recovers cleanly on MALFORMED_FUNCTION_CALL with empty text without pushing empty model parts', async () => {
    let secondCallContents = null;
    generateAgentTurn
      .mockResolvedValueOnce({
        functionCalls: [],
        text: '',
        finishReason: 'MALFORMED_FUNCTION_CALL'
      })
      .mockImplementationOnce(async ({ contents }) => {
        secondCallContents = JSON.parse(JSON.stringify(contents));
        return {
          functionCalls: [],
          text: 'Hãy nghỉ các bài kéo nặng trong vài ngày.',
          finishReason: 'STOP'
        };
      });

    const result = await runAiChatTurn({
      db: {},
      userId: '507f1f77bcf86cd799439011',
      historyMessages: [],
      userText: 'Đau cẳng tay khi tập',
      memories: [],
      lang: 'vi'
    });

    expect(generateAgentTurn).toHaveBeenCalledTimes(2);
    expect(secondCallContents).toHaveLength(1);
    expect(secondCallContents[0].role).toBe('user');
    expect(secondCallContents[0].parts).toHaveLength(2);
    expect(result.text).toBe('Hãy nghỉ các bài kéo nặng trong vài ngày.');
  });

  test('recovers on MAX_TOKENS and concatenates prefix with continuation text', async () => {
    generateAgentTurn
      .mockResolvedValueOnce({
        functionCalls: [],
        text: '1. Dừng ngay bài tập gây đau nhói.',
        finishReason: 'MAX_TOKENS'
      })
      .mockResolvedValueOnce({
        functionCalls: [],
        text: '2. Tham khảo bác sĩ nếu cơn đau kéo dài.',
        finishReason: 'STOP'
      });

    const result = await runAiChatTurn({
      db: {},
      userId: '507f1f77bcf86cd799439011',
      historyMessages: [],
      userText: 'Đau cẳng tay',
      memories: [],
      lang: 'vi'
    });

    expect(generateAgentTurn).toHaveBeenCalledTimes(2);
    expect(result.text).toBe(
      '1. Dừng ngay bài tập gây đau nhói.\n2. Tham khảo bác sĩ nếu cơn đau kéo dài.'
    );
  });

  test('bounds recovery to at most 1 retry if retry still ends with ":"', async () => {
    generateAgentTurn
      .mockResolvedValueOnce({
        functionCalls: [],
        text: 'Tôi xin phép tìm kiếm:',
        finishReason: 'STOP'
      })
      .mockResolvedValueOnce({
        functionCalls: [],
        text: 'Vẫn đang kiểm tra:',
        finishReason: 'STOP'
      });

    const result = await runAiChatTurn({
      db: {},
      userId: '507f1f77bcf86cd799439011',
      historyMessages: [],
      userText: 'Đau cẳng tay',
      memories: [],
      lang: 'vi'
    });

    expect(generateAgentTurn).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('Vẫn đang kiểm tra:');
  });

  test('does not retry on a normal complete answer', async () => {
    generateAgentTurn.mockResolvedValueOnce({
      functionCalls: [],
      text: 'Chào bạn! Hôm nay bạn muốn tập nhóm cơ nào?',
      finishReason: 'STOP'
    });

    const result = await runAiChatTurn({
      db: {},
      userId: '507f1f77bcf86cd799439011',
      historyMessages: [],
      userText: 'Hello',
      memories: [],
      lang: 'vi'
    });

    expect(generateAgentTurn).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('Chào bạn! Hôm nay bạn muốn tập nhóm cơ nào?');
  });
});
