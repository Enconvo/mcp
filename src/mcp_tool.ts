import {
  RequestOptions,
  EnconvoResponse,
  DxtManifest,
  Extension,
  ChatMessageContent,
  getProjectEnv,
} from "@enconvo/api";
import { runInNewContext } from "vm";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthFlowManager, SimpleOAuthClientProvider } from "@enconvo/mcp";

interface ClientEntry {
  client: Client;
  lastUsed: number;
  timeoutId: NodeJS.Timeout | null;
}

let clients: Record<string, ClientEntry> = {};
const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 5 minutes

interface MCPRequestOptions extends RequestOptions {
  mcpOptions?: RequestOptions & {
    mcp_args?: string
  }
}

export default async function main(req: Request): Promise<EnconvoResponse> {
  const options: MCPRequestOptions = await req.json();
  const mcpOptions = options.mcpOptions || options

  const { commandName, extensionName, parameters } = mcpOptions;
  console.log("mcp_tool params", options.commandName, JSON.stringify(mcpOptions, null, 2))
  if (!extensionName || !commandName) {
    return EnconvoResponse.error("extensionName and commandName is required");
  }
  const params = Object.keys(parameters.properties).reduce(
    (acc: any, key: string) => {
      acc[key] = mcpOptions[key];
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
      mcpOptions.mcp_entry_point || manifestInfo.server.entry_point;
    let env;
    if (
      manifestInfo.server.type === "http" ||
      manifestInfo.server.type === "sse"
    ) {
      env = mcpOptions.mcp_headers
        ? Object.fromEntries(
          mcpOptions.mcp_headers
            ?.split("\n")
            ?.map((item: string) => item.split("=")) || []
        )
        : manifestInfo.server.mcp_config?.env;
    } else {
      env = mcpOptions.mcp_env
        ? Object.fromEntries(
          mcpOptions.mcp_env
            ?.split("\n")
            ?.map((item: string) => item.split("=")) || []
        )
        : manifestInfo.server.mcp_config?.env;
    }
    manifestInfo.server.mcp_config = {
      command: mcpOptions.mcp_command || manifestInfo.server.mcp_config?.command,
      args:
        mcpOptions.mcp_args?.split("\n") || manifestInfo.server.mcp_config?.args,
      env: env,
    };
  }

  let userConfig = manifestInfo.user_config
    ? Object.fromEntries(
      Object.entries(manifestInfo.user_config)
        .filter(([key]) => key in mcpOptions)
        .map(([key]) => [key, mcpOptions[key]])
        .sort((a, b) => a[0].localeCompare(b[0]))
    )
    : {};

  if (mcpOptions.credentials) {
    userConfig = {
      ...userConfig,
      ...mcpOptions.credentials,
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
  // console.log("serverKey", serverKey);

  let clientEntry = clients[serverKey];
  // console.log("client ", clientEntry === undefined)
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

  let workdir = await getProjectEnv()
  console.log("workdir", workdir, options.agentRealCommandName, mcpOptions.filename)
  if (!workdir.endsWith(options.agentRealCommandName)) {
    workdir = path.join(workdir, options.agentRealCommandName)
  }


  const content: ChatMessageContent[] = (toolResult.content as any[])?.map((item: any) => {
    switch (item.type) {
      case "text":
        return { type: "text", text: item.text } as ChatMessageContent;
      case "image":
        return { type: "image_url", image_url: { url: saveBase64ToFile(item.data, item.mimeType, workdir, mcpOptions.filename) } } as ChatMessageContent;
      case "audio":
        return { type: "audio", file_url: { url: saveBase64ToFile(item.data, item.mimeType, workdir, mcpOptions.filename) } } as ChatMessageContent;
      case "resource_link":
        return { type: "text", text: `[${item.name}](${item.uri})${item.description ? ` - ${item.description}` : ""}` } as ChatMessageContent;
      case "resource":
        if (item.resource?.text) {
          return { type: "text", text: item.resource.text } as ChatMessageContent;
        } else if (item.resource?.blob) {
          const mimeType = item.resource.mimeType || "application/octet-stream";
          if (mimeType.startsWith("image/")) {
            return { type: "image_url", image_url: { url: saveBase64ToFile(item.resource.blob, mimeType, workdir, mcpOptions.filename) } } as ChatMessageContent;
          } else if (mimeType.startsWith("audio/")) {
            return { type: "audio", file_url: { url: saveBase64ToFile(item.resource.blob, mimeType, workdir, mcpOptions.filename) } } as ChatMessageContent;
          }
          return { type: "text", text: item.resource.blob } as ChatMessageContent;
        }
        return { type: "text", text: JSON.stringify(item) } as ChatMessageContent;
      default:
        return { type: "text", text: JSON.stringify(item) } as ChatMessageContent;
    }
  }) || [{ type: "text", text: JSON.stringify(toolResult) }];

  return EnconvoResponse.content(content, toolResult.isError as boolean | undefined);
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
};

function saveBase64ToFile(base64Data: string, mimeType: string, rootDir: string, filename?: string): string {
  const ext = MIME_TO_EXT[mimeType] || `.${mimeType.split("/")[1] || "bin"}`;
  const fileName = filename || `mcp_${crypto.randomUUID()}${ext}`;
  const dir = rootDir || os.tmpdir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, new Uint8Array(Buffer.from(base64Data, "base64")));
  return filePath;
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


let oauthProvider: SimpleOAuthClientProvider | null = null;

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
  const args: string[] = [];
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
    console.log("result http", manifestInfo.server.entry_point, result2);

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

    oauthProvider = await OAuthFlowManager.createOCredentialsProvider(extensionName);

    transport = new StreamableHTTPClientTransport(new URL(result2), {
      requestInit: {
        headers: envs,
      },
      authProvider: oauthProvider
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
    console.log("result sse", manifestInfo.server.entry_point, result2);

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
    console.log("oauthProvider", extensionName, envs);

    oauthProvider = await OAuthFlowManager.createOCredentialsProvider(extensionName);

    transport = new SSEClientTransport(new URL(result2), {
      requestInit: {
        headers: envs,
      },
      authProvider: oauthProvider
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
      console.log("result3", arg, result2);
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
    console.log("stdio transport", manifestInfo.server?.mcp_config?.command, args, envs, extensionPath);

    transport = new StdioClientTransport({
      command: manifestInfo.server?.mcp_config?.command || "",
      args: args,
      env: envs,
      cwd: extensionPath
    });
  }

  console.time("mcp.connect");
  try {
    await mcp.connect(transport);
  } catch (error) {
    if (error instanceof UnauthorizedError && transport instanceof StreamableHTTPClientTransport) {
      console.log('🔐 OAuth authorization required - waiting for user authorization...');
      const actualCallbackPort = OAuthFlowManager.getCallbackPort(oauthProvider?.redirectUrl as string);
      console.log('🔐 actualCallbackPort', actualCallbackPort);
      const authCode = await OAuthFlowManager.waitForOAuthCallback(extensionName, actualCallbackPort);
      console.log('🔐 Authorization code received, completing auth flow...');
      await transport.finishAuth(authCode);
      console.log('🔌 Reconnecting with authenticated transport...');
      return createNewClient(manifestInfo, extensionName, extensionPath, userConfig, serverKey);
    } else {
      console.error('❌ Connection failed (non-auth error):', error);
      throw error;
    }
  }
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
