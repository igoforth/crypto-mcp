# @igoforth/crypto-mcp

Minimal, auditable MCP server for inspecting Ethereum/Polygon wallet balances and transactions.

## Security

- **Minimal dependencies**: Only `viem`, `@modelcontextprotocol/sdk`, and `zod`
- **Read-only**: No transaction signing or wallet operations
- **Auditable**: Single file, <300 lines of code
- **Type-safe**: Full TypeScript with Zod validation

## Tools

| Tool | Description |
|------|-------------|
| `get_balance` | Get wallet balance — native only, specific ERC-20, or `"all"` for native + common tokens |
| `get_transaction_count` | Get transaction count (nonce) for an address |
| `get_erc20_transfers` | Get ERC-20 transfer history (incoming/outgoing) |

## Supported Chains

- Ethereum Mainnet
- Polygon (default)
- Polygon Amoy Testnet

## Common Tokens (Polygon)

| Token | Address |
|-------|---------|
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| DAI | `0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063` |
| WETH | `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619` |
| WMATIC | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` |

## Installation

```bash
npm install -g @igoforth/crypto-mcp
```

Or with pnpm:

```bash
pnpm add -g @igoforth/crypto-mcp
```

## Usage

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "crypto-wallet": {
      "command": "crypto-mcp"
    }
  }
}
```

### Claude Desktop

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "crypto-wallet": {
      "command": "npx",
      "args": ["-y", "@igoforth/crypto-mcp"]
    }
  }
}
```

### Example Queries

Once configured, you can ask:

- "Check my USDC balance on Polygon for address 0x..."
- "Get all token balances for 0x..."
- "What's the MATIC balance for my wallet?"
- "Show recent USDC transfers for 0x..."

## RPC Configuration

Uses [PublicNode](https://publicnode.com/) free RPC endpoints by default — no API keys required.

All tools accept an optional `rpcUrl` parameter to use a custom RPC endpoint (e.g. Alchemy, Infura).

## License

MIT
