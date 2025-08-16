import { EnconvoResponse, RequestOptions } from "@enconvo/api";
import {
  UnauthorizedError
} from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthFlowManager } from "./utils/oauth_flow_manager.js";



export default async function main(req: Request): Promise<EnconvoResponse> {
  const options: RequestOptions = await req.json();
  const mcpServerUrl = "https://mcp.notion.com/mcp";
  const callbackPort = 54575;

  try {
    console.log('🚀 开始OAuth流程...');
    const oauthFlow = new OAuthFlowManager(mcpServerUrl, callbackPort, `${options.extensionName}|${options.commandName}`);

    const toolsResult = await oauthFlow.executeOAuthFlow();

    return {
      status: 200,
      body: JSON.stringify({
        success: true,
        message: "OAuth认证成功，已连接到MCP服务器",
        timestamp: new Date().toISOString(),
        tools: toolsResult
      }, null, 2),
    };

  } catch (error) {
    console.error('❌ OAuth流程失败:', error);

    if (error instanceof UnauthorizedError) {
      return {
        status: 401,
        body: JSON.stringify({
          success: false,
          error: "OAuth授权失败",
          message: "请完成OAuth授权流程以访问MCP工具",
          timestamp: new Date().toISOString()
        }),
      };
    }

    return {
      status: 500,
      body: JSON.stringify({
        success: false,
        error: "连接MCP服务器失败",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }),
    };
  }
}
