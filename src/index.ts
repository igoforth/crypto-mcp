#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./register.js";

const server = new McpServer({
	name: "crypto-wallet-inspector",
	version: "1.1.0",
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Crypto Wallet Inspector MCP server v1.1.0 running on stdio");
