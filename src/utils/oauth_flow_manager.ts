import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthClientMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { SimpleOAuthClientProvider } from "./simple_oauth_client_provider.js";
import { createServer } from "http";
import { URL } from "url";
import { findAvailablePort } from "./port.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { generateOAuthSuccessPage, generateOAuthErrorPage } from "./oauth_success_template.js";

/**
 * OAuth Flow Manager - handles complete authentication flow
 */
export class OAuthFlowManager {
  private client: Client | null = null;
  private oauthProvider: SimpleOAuthClientProvider | null = null;
  private actualCallbackPort: number = 0;

  constructor(private serverUrl: string, private preferredCallbackPort: number, private clientName: string) {
  }


  /**
   * Start OAuth callback server and wait for authorization code
   */
  private async waitForOAuthCallback(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const httpServer = createServer((req, res) => {
        if (req.url === '/favicon.ico') {
          res.writeHead(404);
          res.end();
          return;
        }

        console.log(`📥 Received callback: ${req.url}`);
        const parsedUrl = new URL(req.url || '', 'http://localhost');
        const code = parsedUrl.searchParams.get('code');
        const error = parsedUrl.searchParams.get('error');

        if (code) {
          console.log(`✅ Authorization code received: ${code.substring(0, 10)}...`);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          const [extensionName, commandName] = this.clientName.split('|');
          res.end(generateOAuthSuccessPage(extensionName || 'MCP', commandName || 'OAuth'));

          resolve(code);
          setTimeout(() => httpServer.close(), 3000);
        } else if (error) {
          console.log(`❌ Authorization error: ${error}`);
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(generateOAuthErrorPage(error));
          reject(new Error(`OAuth authorization failed: ${error}`));
        } else {
          console.log(`❌ No authorization code or error in callback`);
          res.writeHead(400);
          res.end('Bad request');
          reject(new Error('No authorization code provided'));
        }
      });

      // Start server on determined port
      httpServer.listen(this.actualCallbackPort, () => {
        console.log(`OAuth callback server started: http://localhost:${this.actualCallbackPort}`);
      });

      httpServer.on('error', (err) => {
        reject(new Error(`Failed to start callback server: ${err.message}`));
      });

      // 5 minute timeout
      setTimeout(() => {
        httpServer.close();
        reject(new Error('OAuth authorization timeout'));
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Attempt to connect to MCP server
   */
  private async attemptConnection(transport: StreamableHTTPClientTransport): Promise<void> {
    try {
      console.log('🔌 Attempting to connect to MCP server...');
      await this.client!.connect(transport);
      console.log('✅ Connection successful');
    } catch (error) {
      await this.client?.close()
      if (error instanceof UnauthorizedError) {
        console.log('🔐 OAuth authorization required - waiting for user authorization...');
        const authCode = await this.waitForOAuthCallback();
        console.log('🔐 Authorization code received, completing auth flow...');
        await transport.finishAuth(authCode);
        console.log('🔌 Reconnecting with authenticated transport...');
        await this.executeOAuthFlow()
      } else {
        console.error('❌ Connection failed (non-auth error):', error);
        throw error;
      }
    }
  }

  /**
   * Execute complete OAuth flow and get tools list
   */
  async executeOAuthFlow(): Promise<any> {
    if (!this.oauthProvider) {
      console.log("🔍 Creating OAuth client provider");
      // Find available port in advance
      this.actualCallbackPort = await findAvailablePort(this.preferredCallbackPort);
      console.log(`🔍 Using callback port: ${this.actualCallbackPort}`);

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
      console.error('❌ MCP server error:', error);
    };

    this.client.onclose = () => {
      console.log('✅ MCP server closed');
    };

    const baseUrl = new URL(this.serverUrl);
    const transport = new StreamableHTTPClientTransport(baseUrl, {
      authProvider: this.oauthProvider
    });

    await this.attemptConnection(transport);

    // Get tools list
    const toolsResult = await this.client.request({
      method: 'tools/list',
      params: {},
    }, ListToolsResultSchema);

    return toolsResult;
  }
}