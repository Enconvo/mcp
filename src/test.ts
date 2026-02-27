import { EnconvoResponse, RequestOptions } from "@enconvo/api";
import { OAuthFlowManager } from "@enconvo/mcp";
import {
  UnauthorizedError
} from "@modelcontextprotocol/sdk/client/auth.js";



export default async function main(req: Request): Promise<EnconvoResponse> {
  const options: RequestOptions = await req.json();
  // const mcpServerUrl = "https://server.smithery.ai/@nickclyde/duckduckgo-mcp-server/mcp";
  // const mcpServerUrl = "https://api.githubcopilot.com/mcp/";
  const mcpServerUrl = "https://mcp.notion.com/mcp";

  try {
    console.log('🚀 Starting OAuth flow...');
    const oauthFlow = new OAuthFlowManager(mcpServerUrl, `${options.extensionName}`);

    const toolsResult = await oauthFlow.executeOAuthFlow();

    return {
      status: 200,
      body: JSON.stringify({
        success: true,
        message: "OAuth authentication successful, connected to MCP server",
        timestamp: new Date().toISOString(),
        tools: toolsResult
      }, null, 2),
    };

  } catch (error) {
    console.error('❌ OAuth flow failed:', error);

    if (error instanceof UnauthorizedError) {
      return {
        status: 401,
        body: JSON.stringify({
          success: false,
          error: "OAuth authorization failed",
          message: "Please complete the OAuth authorization flow to access MCP tools",
          timestamp: new Date().toISOString()
        }),
      };
    }

    return {
      status: 500,
      body: JSON.stringify({
        success: false,
        error: "Failed to connect to MCP server",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }),
    };
  }
}
