#!/usr/bin/env node

const readline = require("node:readline");
const { handleMcpRequest } = require("./lib/mcpServer");

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

async function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: error && error.message ? error.message : "Parse error.",
        },
      })}\n`
    );
    return;
  }

  const response = await handleMcpRequest(request);
  if (response) {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

rl.on("line", (line) => {
  handleLine(line).catch((error) => {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: error && error.message ? error.message : "Internal error.",
        },
      })}\n`
    );
  });
});
