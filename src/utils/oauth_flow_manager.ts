import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthClientMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { SimpleOAuthClientProvider } from "./simple_oauth_client_provider.js";
import { createServer } from "http";
import { URL } from "url";
import { findAvailablePort } from "./port.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * OAuth流程管理器，处理完整的授权流程
 */
export class OAuthFlowManager {
  private client: Client | null = null;
  private oauthProvider: SimpleOAuthClientProvider | null = null;
  private actualCallbackPort: number = 0;

  constructor(private serverUrl: string, private preferredCallbackPort: number, private clientName: string) {
  }


  /**
   * 启动OAuth回调服务器，等待授权码
   */
  private async waitForOAuthCallback(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const httpServer = createServer((req, res) => {
        if (req.url === '/favicon.ico') {
          res.writeHead(404);
          res.end();
          return;
        }

        console.log(`📥 收到回调: ${req.url}`);
        const parsedUrl = new URL(req.url || '', 'http://localhost');
        const code = parsedUrl.searchParams.get('code');
        const error = parsedUrl.searchParams.get('error');

        if (code) {
          console.log(`✅ 授权码已接收: ${code.substring(0, 10)}...`);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html>
              <head><meta charset="utf-8"></head>
              <body>
                <h1>授权成功！</h1>
                <p>您可以关闭此窗口并返回应用程序。</p>
                <script>setTimeout(() => window.close(), 2000);</script>
              </body>
            </html>
          `);

          resolve(code);
          setTimeout(() => httpServer.close(), 3000);
        } else if (error) {
          console.log(`❌ 授权错误: ${error}`);
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html>
              <head><meta charset="utf-8"></head>
              <body>
                <h1>授权失败</h1>
                <p>错误: ${error}</p>
              </body>
            </html>
          `);
          reject(new Error(`OAuth授权失败: ${error}`));
        } else {
          console.log(`❌ 回调中没有授权码或错误信息`);
          res.writeHead(400);
          res.end('Bad request');
          reject(new Error('没有提供授权码'));
        }
      });

      // 使用已确定的端口启动服务器
      httpServer.listen(this.actualCallbackPort, () => {
        console.log(`OAuth回调服务器已启动: http://localhost:${this.actualCallbackPort}`);
      });

      httpServer.on('error', (err) => {
        reject(new Error(`启动回调服务器失败: ${err.message}`));
      });

      // 5分钟超时
      setTimeout(() => {
        httpServer.close();
        reject(new Error('OAuth授权超时'));
      }, 5 * 60 * 1000);
    });
  }

  /**
   * 尝试连接到MCP服务器
   */
  private async attemptConnection(transport: StreamableHTTPClientTransport): Promise<void> {
    try {
      console.log('🔌 尝试连接MCP服务器...');
      await this.client!.connect(transport);
      console.log('✅ 连接成功');
    } catch (error) {
      await this.client?.close()
      if (error instanceof UnauthorizedError) {
        console.log('🔐 需要OAuth授权 - 等待用户授权...');
        const authCode = await this.waitForOAuthCallback();
        console.log('🔐 收到授权码，完成授权流程...');
        await transport.finishAuth(authCode);
        console.log('🔌 使用已认证的传输重新连接...');
        await this.executeOAuthFlow()
      } else {
        console.error('❌ 连接失败（非授权错误）:', error);
        throw error;
      }
    }
  }

  /**
   * 执行完整的OAuth流程并获取工具列表
   */
  async executeOAuthFlow(): Promise<any> {
    if (!this.oauthProvider) {
      console.log("🔍 创建OAuth客户端提供者");
      // 预先查找可用端口
      this.actualCallbackPort = await findAvailablePort(this.preferredCallbackPort);
      console.log(`🔍 使用回调端口: ${this.actualCallbackPort}`);

      const callbackUrl = `http://localhost:${this.actualCallbackPort}/callback`;

      const clientMetadata: OAuthClientMetadata = {
        client_name: this.clientName,
        redirect_uris: [callbackUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        scope: 'mcp:tools'
      };
      this.oauthProvider = new SimpleOAuthClientProvider(callbackUrl, clientMetadata);
    }


    this.client = new Client({
      name: this.clientName,
      version: '1.0.0',
    }, { capabilities: {} });
    this.client.onerror = (error) => {
      console.error('❌ MCP服务器错误:', error);
    };

    this.client.onclose = () => {
      console.log('✅ MCP服务器关闭');
    };

    const baseUrl = new URL(this.serverUrl);
    const transport = new StreamableHTTPClientTransport(baseUrl, {
      authProvider: this.oauthProvider
    });

    await this.attemptConnection(transport);

    // 获取工具列表
    const toolsResult = await this.client.request({
      method: 'tools/list',
      params: {},
    }, ListToolsResultSchema);

    return toolsResult;
  }
}