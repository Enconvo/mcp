import {
  RequestOptions,
  EnconvoResponse,
  DxtManifest,
  Extension,
  ChatMessageContent,
} from "@enconvo/api";
import { runInNewContext } from "vm";
import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

interface ClientEntry {
  client: Client;
  lastUsed: number;
  timeoutId: NodeJS.Timeout | null;
}

let clients: Record<string, ClientEntry> = {};
const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 5 minutes

export default async function main(req: Request): Promise<EnconvoResponse> {
  let options: RequestOptions = await req.json();
  const { commandName, extensionName, parameters } = options;
  // console.log("mcp_tool params", JSON.stringify(options, null, 2))
  if (!extensionName || !commandName) {
    return EnconvoResponse.error("extensionName and commandName is required");
  }
  const params = Object.keys(parameters.properties).reduce(
    (acc: any, key: string) => {
      acc[key] = options[key];
      return acc;
    },
    {} as any
  );

  const extensionPath = Extension.getExtensionPath(extensionName);
  const manifest = fs.readFileSync(
    path.join(extensionPath, "manifest.json"),
    "utf8"
  );
  let manifestInfo: DxtManifest = JSON.parse(manifest);
  // console.log("manifestInfo", manifestInfo, options.mcp_headers)
  if (manifestInfo.server) {
    manifestInfo.server.entry_point =
      options.mcp_entry_point || manifestInfo.server.entry_point;
    let env;
    if (
      manifestInfo.server.type === "http" ||
      manifestInfo.server.type === "sse"
    ) {
      env = options.mcp_headers
        ? Object.fromEntries(
            options.mcp_headers
              ?.split("\n")
              ?.map((item: string) => item.split("=")) || []
          )
        : manifestInfo.server.mcp_config?.env;
    } else {
      env = options.mcp_env
        ? Object.fromEntries(
            options.mcp_env
              ?.split("\n")
              ?.map((item: string) => item.split("=")) || []
          )
        : manifestInfo.server.mcp_config?.env;
    }
    manifestInfo.server.mcp_config = {
      command: options.mcp_command || manifestInfo.server.mcp_config?.command,
      args:
        options.mcp_args?.split("\n") || manifestInfo.server.mcp_config?.args,
      env: env,
    };
  }

  let userConfig = manifestInfo.user_config
    ? Object.fromEntries(
        Object.entries(manifestInfo.user_config)
          .filter(([key]) => key in options)
          .map(([key]) => [key, options[key]])
          .sort((a, b) => a[0].localeCompare(b[0]))
      )
    : {};

  if (options.credentials) {
    userConfig = {
      ...userConfig,
      ...options.credentials,
    };
  }

  // Filter out undefined values from userConfig
  userConfig = Object.fromEntries(
    Object.entries(userConfig).filter(([, value]) => value !== undefined)
  );
  const keyObject = {
    ...userConfig,
    mcpConfig: manifestInfo.server?.mcp_config,
    extensionName: extensionName,
  };
  const serverKey = JSON.stringify(keyObject);
  console.log("serverKey", serverKey);

  let clientEntry = clients[serverKey];
  if (!clientEntry) {
    const mcp = await createNewClient(
      manifestInfo,
      extensionName,
      extensionPath,
      userConfig,
      serverKey
    );
    clientEntry = {
      client: mcp,
      lastUsed: Date.now(),
      timeoutId: null,
    };
    clients[serverKey] = clientEntry;
    scheduleClientCleanup(serverKey, clientEntry);
  } else {
    // Update last used time and reschedule cleanup
    clientEntry.lastUsed = Date.now();
    if (clientEntry.timeoutId) {
      clearTimeout(clientEntry.timeoutId);
    }
    scheduleClientCleanup(serverKey, clientEntry);
  }

  const toolResult = await clientEntry.client.callTool({
    name: commandName,
    arguments: params,
  });

  // console.log("toolResult", toolResult)

  return EnconvoResponse.content(toolResult.content as ChatMessageContent[]);
}

function scheduleClientCleanup(serverKey: string, clientEntry: ClientEntry) {
  clientEntry.timeoutId = setTimeout(() => {
    const entry = clients[serverKey];
    if (entry && Date.now() - entry.lastUsed >= IDLE_TIMEOUT_MS) {
      console.log(`Closing idle MCP client: ${serverKey}`);
      try {
        entry.client.close();
      } catch (error) {
        console.error(`Error closing MCP client ${serverKey}:`, error);
      } finally {
        delete clients[serverKey];
      }
    }
  }, IDLE_TIMEOUT_MS);
}

// Graceful cleanup on process exit
function cleanupAllClients() {
  Object.entries(clients).forEach(([serverKey, entry]) => {
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    try {
      entry.client.close();
    } catch (error) {
      console.error(
        `Error closing MCP client ${serverKey} during cleanup:`,
        error
      );
    }
  });
  clients = {};
}

process.on("exit", cleanupAllClients);
process.on("SIGINT", () => {
  console.log("SIGINT");
  cleanupAllClients();
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("SIGTERM");
  cleanupAllClients();
  process.exit(0);
});

async function createNewClient(
  manifestInfo: DxtManifest,
  extensionName: string,
  extensionPath: string,
  userConfig: Record<string, any>,
  serverKey: string
) {
  const mcp = new Client({
    name: extensionName,
    version: manifestInfo.version || "0.0.1",
  });
  const args = [];
  const __dirname = extensionPath;

  let transport: Transport;
  if (manifestInfo.server?.type === "http") {
    const result = runInNewContext(`\`${manifestInfo.server.entry_point}\``, {
      __dirname,
      HOME: process.env.HOME,
      user_config: userConfig,
    });

    const result2 = runInNewContext(`\`${result}\``, {
      __dirname,
      HOME: process.env.HOME,
      user_config: userConfig,
    });
    console.log("result2", manifestInfo.server.entry_point, result2);

    let envs: Record<string, string> = {};
    if (manifestInfo.server?.mcp_config?.env) {
      for (const [key, value] of Object.entries(
        manifestInfo.server?.mcp_config?.env || {}
      )) {
        const result = runInNewContext(`\`${value}\``, {
          __dirname,
          HOME: process.env.HOME,
          user_config: userConfig,
        });

        const result2 = runInNewContext(`\`${result}\``, {
          __dirname,
          HOME: process.env.HOME,
          user_config: userConfig,
        });

        envs[key] = result2;
      }
    }

    transport = new StreamableHTTPClientTransport(new URL(result2), {
      requestInit: {
        headers: envs,
      },
    });
  } else if (manifestInfo.server?.type === "sse") {
    const result = runInNewContext(`\`${manifestInfo.server.entry_point}\``, {
      __dirname,
      HOME: process.env.HOME,
      user_config: userConfig,
    });

    const result2 = runInNewContext(`\`${result}\``, {
      __dirname,
      HOME: process.env.HOME,
      user_config: userConfig,
    });
    console.log("result2", manifestInfo.server.entry_point, result2);

    let envs: Record<string, string> = {};
    if (manifestInfo.server?.mcp_config?.env) {
      for (const [key, value] of Object.entries(
        manifestInfo.server?.mcp_config?.env || {}
      )) {
        const result = runInNewContext(`\`${value}\``, {
          __dirname,
          HOME: process.env.HOME,
          user_config: userConfig,
        });

        const result2 = runInNewContext(`\`${result}\``, {
          __dirname,
          HOME: process.env.HOME,
          user_config: userConfig,
        });
        envs[key] = result2;
      }
    }

    transport = new SSEClientTransport(new URL(result2), {
      requestInit: {
        headers: envs,
      },
    });
  } else {
    for (const arg of manifestInfo.server?.mcp_config?.args || []) {
      const result = runInNewContext(`\`${arg}\``, {
        __dirname,
        HOME: process.env.HOME,
        user_config: userConfig,
      });

      const result2 = runInNewContext(`\`${result}\``, {
        __dirname,
        HOME: process.env.HOME,
        user_config: userConfig,
      });
      console.log("result2", arg, result2);
      args.push(result2);
    }

    let envs: Record<string, string> = {};
    if (manifestInfo.server?.mcp_config?.env) {
      for (const [key, value] of Object.entries(
        manifestInfo.server?.mcp_config?.env || {}
      )) {
        const result = runInNewContext(`\`${value}\``, {
          __dirname,
          HOME: process.env.HOME,
          user_config: userConfig,
        });

        const result2 = runInNewContext(`\`${result}\``, {
          __dirname,
          HOME: process.env.HOME,
          user_config: userConfig,
        });

        envs[key] = result2;
      }
    }
    transport = new StdioClientTransport({
      command: manifestInfo.server?.mcp_config?.command || "",
      args: args,
      env: envs,
    });
  }

  console.time("mcp.connect");
  await mcp.connect(transport);
  console.timeEnd("mcp.connect");
  mcp.onclose = () => {
    const entry = clients[serverKey];
    if (entry?.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    delete clients[serverKey];
    console.log("mcp closed");
  };
  mcp.onerror = (error: Error) => {
    console.error("mcp error", error);
    // Clean up on error
    const entry = clients[serverKey];
    if (entry?.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    delete clients[serverKey];
  };

  return mcp;
}
