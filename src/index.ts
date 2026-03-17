#!/usr/bin/env node

/**
 * Crypto Wallet Inspector MCP Server
 *
 * Minimal, auditable MCP server for inspecting Ethereum/Polygon wallets.
 * Uses only viem (trusted, 3k+ stars) for blockchain interactions.
 *
 * Tools:
 * - get_balance: Get wallet balance (native, specific token, or all tokens)
 * - get_transaction_count: Get transaction count (nonce) for an address
 * - get_erc20_transfers: Get ERC-20 transfer history (incoming/outgoing)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	type Address,
	type Chain,
	createPublicClient,
	formatUnits,
	getAddress,
	http,
} from "viem";
import { mainnet, polygon, polygonAmoy } from "viem/chains";
import * as z from "zod";

// Common ERC-20 tokens on Polygon
const COMMON_TOKENS = {
	"USDC.e": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
	USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Native USDC
	USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
	DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
	WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
	WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
} as const;

// ERC-20 ABI (minimal - balanceOf, decimals, symbol)
const ERC20_ABI = [
	{
		name: "balanceOf",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "account", type: "address" }],
		outputs: [{ name: "", type: "uint256" }],
	},
	{
		name: "decimals",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "uint8" }],
	},
	{
		name: "symbol",
		type: "function",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "string" }],
	},
] as const;

// Supported chains
const CHAINS: Record<string, Chain> = {
	mainnet,
	polygon,
	"polygon-amoy": polygonAmoy,
};

// RPC clients for each chain
const clients = new Map<string, ReturnType<typeof createPublicClient>>();

// Initialize RPC clients
function initializeClients() {
	for (const [name, chain] of Object.entries(CHAINS)) {
		const transport = http(getRpcUrl(chain.id));

		clients.set(
			name,
			createPublicClient({
				chain,
				transport,
			}),
		);
	}
}

function getRpcUrl(chainId: number): string {
	switch (chainId) {
		case 1: // Ethereum mainnet
			return "https://ethereum-rpc.publicnode.com";
		case 137: // Polygon
			return "https://polygon-bor-rpc.publicnode.com";
		case 80002: // Polygon Amoy testnet
			// Polygon Amoy is deprecated; fallback to public RPC from viem chain config
			return "https://rpc-amoy.polygon.technology";
		default:
			throw new Error(`Unsupported chain ID: ${chainId}`);
	}
}

function getClient(chain: string, customRpcUrl?: string) {
	// If a custom RPC URL is provided, create a temporary client
	if (customRpcUrl) {
		const chainConfig = CHAINS[chain];
		if (!chainConfig) {
			throw new Error(
				`Unsupported chain: ${chain}. Supported: ${Object.keys(CHAINS).join(", ")}`,
			);
		}
		return createPublicClient({
			chain: chainConfig,
			transport: http(customRpcUrl),
		});
	}

	// Otherwise use the cached client
	const client = clients.get(chain);
	if (!client) {
		throw new Error(
			`Unsupported chain: ${chain}. Supported: ${Array.from(clients.keys()).join(", ")}`,
		);
	}
	return client;
}

function formatResponse(data: unknown) {
	return {
		content: [
			{
				type: "text" as const,
				text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
			},
		],
	};
}

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new McpServer({
	name: "crypto-wallet-inspector",
	version: "1.0.0",
});

// ============================================================================
// TOOLS - Unified Balance
// ============================================================================

server.registerTool(
	"get_balance",
	{
		title: "Get Wallet Balance",
		description:
			"Get wallet balance. Omit token for native only, use 'all' for native + common ERC-20s, or specify a token symbol/address.",
		inputSchema: {
			address: z.string().describe("Wallet address (0x...)"),
			token: z
				.string()
				.optional()
				.describe(
					"Token to query: omit for native only, 'all' for native + common tokens, or specific token (USDC.e, USDC, USDT, DAI, WETH, WMATIC, or 0x address)",
				),
			chain: z
				.enum(["mainnet", "polygon", "polygon-amoy"])
				.default("polygon")
				.describe("Blockchain to query"),
			rpcUrl: z
				.string()
				.optional()
				.describe(
					"Optional custom RPC URL (defaults to publicnode.com for the selected chain)",
				),
		},
	},
	async ({ address, token, chain, rpcUrl }) => {
		const client = getClient(chain, rpcUrl);
		const chainConfig = CHAINS[chain];
		if (!chainConfig) {
			throw new Error(`Chain config not found for: ${chain}`);
		}

		// Case 1: No token specified - return native balance only
		if (!token) {
			const balance = await client.getBalance({
				address: address as Address,
			});

			return formatResponse({
				address,
				chain,
				token: chainConfig.nativeCurrency.symbol,
				balance: formatUnits(balance, chainConfig.nativeCurrency.decimals),
				raw: balance.toString(),
				decimals: chainConfig.nativeCurrency.decimals,
			});
		}

		// Case 2: "all" - return native + all common ERC-20s
		if (token === "all") {
			const balances: Record<
				string,
				{
					balance: string;
					raw: string;
					decimals: number;
					address?: string;
				}
			> = {};

			// Get native balance
			const nativeBalance = await client.getBalance({
				address: address as Address,
			});
			balances[chainConfig.nativeCurrency.symbol] = {
				balance: formatUnits(
					nativeBalance,
					chainConfig.nativeCurrency.decimals,
				),
				raw: nativeBalance.toString(),
				decimals: chainConfig.nativeCurrency.decimals,
			};

			// Get all common token balances
			for (const [symbol, tokenAddress] of Object.entries(COMMON_TOKENS)) {
				try {
					const balance = (await client.readContract({
						address: tokenAddress,
						abi: ERC20_ABI,
						functionName: "balanceOf",
						args: [address as Address],
					})) as bigint;

					const decimals = (await client.readContract({
						address: tokenAddress,
						abi: ERC20_ABI,
						functionName: "decimals",
					})) as number;

					// Only include non-zero balances
					if (balance > 0n) {
						balances[symbol] = {
							balance: formatUnits(balance, decimals),
							raw: balance.toString(),
							decimals,
							address: tokenAddress,
						};
					}
				} catch {
					// Skip tokens that fail (might not exist on this chain)
					continue;
				}
			}

			return formatResponse({
				address,
				chain,
				balances,
			});
		}

		// Case 3: Specific ERC-20 token
		let tokenAddress = token as Address;
		let tokenSymbol = token;

		if (!token.startsWith("0x")) {
			const commonToken = COMMON_TOKENS[token as keyof typeof COMMON_TOKENS];
			if (!commonToken) {
				throw new Error(
					`Unknown token symbol: ${token}. Use address or one of: ${Object.keys(COMMON_TOKENS).join(", ")}`,
				);
			}
			tokenAddress = commonToken;
			tokenSymbol = token;
		}

		// Get balance
		const balance = (await client.readContract({
			address: tokenAddress,
			abi: ERC20_ABI,
			functionName: "balanceOf",
			args: [address as Address],
		})) as bigint;

		// Get decimals
		const decimals = (await client.readContract({
			address: tokenAddress,
			abi: ERC20_ABI,
			functionName: "decimals",
		})) as number;

		// Get symbol (only if we don't already have it from common tokens)
		if (token.startsWith("0x")) {
			tokenSymbol = (await client.readContract({
				address: tokenAddress,
				abi: ERC20_ABI,
				functionName: "symbol",
			})) as string;
		}

		return formatResponse({
			address,
			chain,
			token: tokenSymbol,
			tokenAddress,
			balance: formatUnits(balance, decimals),
			raw: balance.toString(),
			decimals,
		});
	},
);

// ============================================================================
// TOOLS - Transaction Count (Nonce)
// ============================================================================

server.registerTool(
	"get_transaction_count",
	{
		title: "Get Transaction Count",
		description:
			"Get transaction count (nonce) for an address - useful for checking if address has been used",
		inputSchema: {
			address: z.string().describe("Wallet address (0x...)"),
			chain: z
				.enum(["mainnet", "polygon", "polygon-amoy"])
				.default("polygon")
				.describe("Blockchain to query"),
			rpcUrl: z
				.string()
				.optional()
				.describe(
					"Optional custom RPC URL (defaults to publicnode.com for the selected chain)",
				),
		},
	},
	async ({ address, chain, rpcUrl }) => {
		const client = getClient(chain, rpcUrl);

		const count = await client.getTransactionCount({
			address: address as Address,
		});

		return formatResponse({
			address,
			chain,
			transactionCount: count,
			isNew: count === 0,
		});
	},
);

// ============================================================================
// TOOLS - ERC-20 Transfers
// ============================================================================

server.registerTool(
	"get_erc20_transfers",
	{
		title: "Get ERC-20 Transfer History",
		description:
			"Get ERC-20 transfer history for an address (incoming and outgoing transfers)",
		inputSchema: {
			address: z.string().describe("Wallet address (0x...)"),
			token: z
				.string()
				.describe(
					"Token contract address (0x...) or symbol (USDC.e, USDC, USDT, DAI, WETH, WMATIC)",
				),
			chain: z
				.enum(["mainnet", "polygon", "polygon-amoy"])
				.default("polygon")
				.describe("Blockchain to query"),
			direction: z
				.enum(["incoming", "outgoing", "all"])
				.default("all")
				.describe("Filter by transfer direction"),
			limit: z
				.number()
				.min(1)
				.max(100)
				.default(20)
				.describe("Maximum number of transfers to return"),
			blocksBack: z
				.number()
				.min(1)
				.max(100000)
				.default(10000)
				.describe(
					"Number of blocks to look back from latest (default: 10000, ~1 day on Polygon)",
				),
			rpcUrl: z
				.string()
				.optional()
				.describe(
					"Optional custom RPC URL (defaults to publicnode.com for the selected chain)",
				),
		},
	},
	async ({ address, token, chain, direction, limit, blocksBack, rpcUrl }) => {
		const client = getClient(chain, rpcUrl);
		const chainConfig = CHAINS[chain];
		if (!chainConfig) {
			throw new Error(`Chain config not found for: ${chain}`);
		}

		// Resolve token address
		const tokenAddress = (
			token.startsWith("0x")
				? token
				: COMMON_TOKENS[token as keyof typeof COMMON_TOKENS]
		) as Address;

		if (!tokenAddress) {
			throw new Error(
				`Unknown token: ${token}. Use contract address or: ${Object.keys(COMMON_TOKENS).join(", ")}`,
			);
		}

		const userAddress = getAddress(address);

		// Get token decimals for formatting
		const decimals = (await client.readContract({
			address: tokenAddress,
			abi: ERC20_ABI,
			functionName: "decimals",
		})) as number;

		const symbol = (await client.readContract({
			address: tokenAddress,
			abi: ERC20_ABI,
			functionName: "symbol",
		})) as string;

		// Build event filters based on direction
		const filters: Array<{
			address: Address;
			event: {
				type: "event";
				name: "Transfer";
				inputs: Array<{ indexed: boolean; name: string; type: string }>;
			};
			args?: Record<string, Address>;
		}> = [];

		const transferEvent = {
			type: "event" as const,
			name: "Transfer" as const,
			inputs: [
				{ indexed: true, name: "from", type: "address" },
				{ indexed: true, name: "to", type: "address" },
				{ indexed: false, name: "value", type: "uint256" },
			],
		};

		if (direction === "incoming" || direction === "all") {
			filters.push({
				address: tokenAddress,
				event: transferEvent,
				args: { to: userAddress },
			});
		}

		if (direction === "outgoing" || direction === "all") {
			filters.push({
				address: tokenAddress,
				event: transferEvent,
				args: { from: userAddress },
			});
		}

		// Get current block number and calculate fromBlock
		const latestBlock = await client.getBlockNumber();
		const fromBlock = latestBlock - BigInt(blocksBack);

		// Alchemy free tier only allows 10 block ranges, so chunk requests
		const CHUNK_SIZE = 10;
		const allLogs = [];

		for (const filter of filters) {
			// Calculate chunks
			let currentFrom = fromBlock;
			while (currentFrom <= latestBlock) {
				const currentTo = currentFrom + BigInt(CHUNK_SIZE - 1);
				const toBlock = currentTo > latestBlock ? latestBlock : currentTo;

				const logs = await client.getLogs({
					address: filter.address,
					event: filter.event,
					args: filter.args,
					fromBlock: currentFrom,
					toBlock,
				});
				allLogs.push(...logs);

				currentFrom = toBlock + BigInt(1);
			}
		}

		// Sort by block number descending
		allLogs.sort((a, b) => Number(b.blockNumber - a.blockNumber));

		// Limit results
		const limitedLogs = allLogs.slice(0, limit);

		// Get block timestamps
		const transfers = await Promise.all(
			limitedLogs.map(async (log) => {
				const block = await client.getBlock({
					blockNumber: log.blockNumber,
				});

				const args = log.args as {
					from: Address;
					to: Address;
					value: bigint;
				};

				const amount = formatUnits(args.value, decimals);
				const isIncoming = args.to.toLowerCase() === userAddress.toLowerCase();

				return {
					transactionHash: log.transactionHash,
					blockNumber: Number(log.blockNumber),
					timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
					direction: isIncoming ? "incoming" : "outgoing",
					from: args.from,
					to: args.to,
					amount,
					symbol,
				};
			}),
		);

		return formatResponse({
			address: userAddress,
			chain,
			token: symbol,
			tokenAddress,
			totalTransfers: allLogs.length,
			showing: transfers.length,
			transfers,
		});
	},
);

// ============================================================================
// START SERVER
// ============================================================================

async function main() {
	// Initialize RPC clients
	initializeClients();

	// Start MCP server
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Crypto Wallet Inspector MCP server v1.0.0 running on stdio");
}

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
