const assert = require("node:assert/strict");
const test = require("node:test");

const { handleMcpRequest } = require("./mcpServer");

test("tools/list exposes search_context with ace-tool compatible arguments", async () => {
  const response = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, 1);
  assert.ok(Array.isArray(response.result.tools));

  const tool = response.result.tools.find((item) => item.name === "search_context");
  assert.ok(tool);
  assert.equal(tool.inputSchema.type, "object");
  assert.deepEqual(tool.inputSchema.required, ["project_root_path", "query"]);
  assert.equal(tool.inputSchema.properties.project_root_path.type, "string");
  assert.equal(tool.inputSchema.properties.query.type, "string");
});

test("tools/call search_context forwards arguments to YCE search", async () => {
  const calls = [];
  const response = await handleMcpRequest(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "search_context",
        arguments: {
          project_root_path: "C:/repo",
          query: "where is auth handled",
          max_results: 3,
          max_turns: 2,
        },
      },
    },
    {
      searchContext: async (input) => {
        calls.push(input);
        return {
          success: true,
          search: {
            result_present: true,
            raw_stdout: "Found 1 relevant file.\n\n  [1/1] C:/repo/src/auth.js (L1-10)",
          },
          errors: [],
        };
      },
    }
  );

  assert.deepEqual(calls, [
    {
      projectRootPath: "C:/repo",
      query: "where is auth handled",
      maxResults: 3,
      maxTurns: 2,
      timeoutMs: undefined,
    },
  ]);
  assert.equal(response.result.isError, false);
  assert.deepEqual(response.result.content, [
    {
      type: "text",
      text: "Found 1 relevant file.\n\n  [1/1] C:/repo/src/auth.js (L1-10)",
    },
  ]);
});

test("tools/call reports invalid search_context arguments as MCP errors", async () => {
  const response = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "search_context",
      arguments: {
        query: "missing project",
      },
    },
  });

  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /project_root_path/);
});
