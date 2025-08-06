# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) extension for the Enconvo platform. The project implements a tool that allows communication with MCP servers through various transport mechanisms (HTTP, SSE, and stdio).

## Architecture

### Core Components

- **mcp_tool.ts**: Main MCP client implementation that handles tool execution
  - Manages multiple client connections via a connection pool (`clients` record)
  - Supports three transport types: HTTP, SSE (Server-Sent Events), and stdio
  - Handles dynamic configuration through manifest parsing and user configuration
  - Uses template string evaluation with `runInNewContext` for configuration interpolation

- **api_list_servers.ts**: Simple API endpoint to list available MCP servers

### Key Architectural Patterns

- **Client Connection Pooling**: Uses a keyed cache (`clients` record) to reuse MCP client connections based on server configuration
- **Dynamic Configuration**: Supports runtime configuration through template strings evaluated in VM context
- **Multi-Transport Support**: Abstracts transport layer with different implementations (HTTP, SSE, stdio)
- **Extension System**: Integrates with Enconvo's extension architecture through manifest.json

## Development Commands

```bash
# Build the extension (uses Enconvo's build system)
npm run build

# Development mode with hot reload
npm run dev

# Code quality
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

## Configuration

The extension uses a manifest-driven configuration system:
- Server configuration is defined in `manifest.json` with `server.mcp_config`
- Supports environment variables and command-line arguments
- Template strings in configuration are evaluated with access to `__dirname`, `HOME`, and `user_config`

## Transport Types

1. **HTTP Transport**: Uses `StreamableHTTPClientTransport` with custom headers
2. **SSE Transport**: Uses `SSEClientTransport` for server-sent events
3. **Stdio Transport**: Uses `StdioClientTransport` for process-based communication

## Key Dependencies

- `@modelcontextprotocol/sdk`: Core MCP protocol implementation
- `@enconvo/api`: Enconvo platform API integration
- Uses Node.js VM context for secure template string evaluation