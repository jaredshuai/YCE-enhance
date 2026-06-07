const { orchestrate } = require("./orchestrator");
const {
  ensureAbsolutePath,
  isDirectory,
  loadRuntimeConfig,
  toPositiveInt,
} = require("./utils");

const SERVER_INFO = {
  name: "yce",
  version: "0.1.0",
};

const SEARCH_CONTEXT_TOOL = {
  name: "search_context",
  description: "Search a codebase semantically with YCE and return relevant files with line ranges.",
  inputSchema: {
    type: "object",
    properties: {
      project_root_path: {
        type: "string",
        description: "Absolute path to the project root directory.",
      },
      query: {
        type: "string",
        description: "Natural-language description of the code or behavior to locate.",
      },
      max_results: {
        type: "integer",
        minimum: 1,
        description: "Maximum number of relevant files to return. Defaults to YCE_ENGINE_MAX_RESULTS.",
      },
      max_turns: {
        type: "integer",
        minimum: 1,
        description: "Maximum YCE semantic search rounds. Defaults to YCE_ENGINE_MAX_TURNS.",
      },
      timeout_ms: {
        type: "integer",
        minimum: 1,
        description: "Search timeout in milliseconds. Defaults to YCE_TIMEOUT_SEARCH_MS.",
      },
    },
    required: ["project_root_path", "query"],
  },
};

function makeResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function makeError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

async function searchContext(input) {
  const projectRootPath = ensureAbsolutePath(assertNonEmptyString(input.projectRootPath, "project_root_path"));
  const query = assertNonEmptyString(input.query, "query");
  if (!isDirectory(projectRootPath)) {
    throw new Error(`project_root_path does not exist or is not a directory: ${projectRootPath}`);
  }

  const config = loadRuntimeConfig();
  const searchConfig = {
    ...config,
    yceEngineMaxResults: toPositiveInt(input.maxResults, config.yceEngineMaxResults),
    yceEngineMaxTurns: toPositiveInt(input.maxTurns, config.yceEngineMaxTurns),
  };

  return orchestrate({
    mode: "search",
    query,
    cwd: projectRootPath,
    timeoutEnhanceMs: config.timeoutEnhanceMs,
    timeoutSearchMs: toPositiveInt(input.timeoutMs, config.timeoutSearchMs),
    config: searchConfig,
  });
}

function formatSearchText(result) {
  const raw = result && result.search ? result.search.raw_stdout : "";
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }

  const errors = Array.isArray(result && result.errors) ? result.errors : [];
  if (errors.length > 0) {
    return errors
      .map((error) => {
        const source = error && error.source ? `${error.source}: ` : "";
        const code = error && error.code ? `[${error.code}] ` : "";
        return `${source}${code}${error && error.message ? error.message : "YCE search failed."}`;
      })
      .join("\n");
  }

  return "YCE search returned no output.";
}

async function callSearchContext(args, deps) {
  const result = await deps.searchContext({
    projectRootPath: args.project_root_path,
    query: args.query,
    maxResults: args.max_results,
    maxTurns: args.max_turns,
    timeoutMs: args.timeout_ms,
  });
  const isError = !(result && result.success && result.search && result.search.result_present);
  return {
    content: [{ type: "text", text: formatSearchText(result) }],
    isError,
  };
}

async function handleMcpRequest(request, deps = {}) {
  const id = request && Object.prototype.hasOwnProperty.call(request, "id") ? request.id : null;
  const method = request && request.method;
  const effectiveDeps = {
    searchContext,
    ...deps,
  };

  try {
    if (!request || request.jsonrpc !== "2.0" || typeof method !== "string") {
      return makeError(id, -32600, "Invalid JSON-RPC request.");
    }

    if (method === "initialize") {
      return makeResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: SERVER_INFO,
      });
    }

    if (method === "notifications/initialized") {
      return null;
    }

    if (method === "tools/list") {
      return makeResult(id, { tools: [SEARCH_CONTEXT_TOOL] });
    }

    if (method === "tools/call") {
      const params = request.params || {};
      if (params.name !== "search_context") {
        return makeError(id, -32601, `Unknown tool: ${params.name || ""}`);
      }
      const args = params.arguments || {};
      assertNonEmptyString(args.project_root_path, "project_root_path");
      assertNonEmptyString(args.query, "query");
      return makeResult(id, await callSearchContext(args, effectiveDeps));
    }

    return makeError(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    const message = error && error.message ? error.message : "YCE MCP request failed.";
    return makeError(id, -32602, message);
  }
}

module.exports = {
  SEARCH_CONTEXT_TOOL,
  handleMcpRequest,
  searchContext,
};
