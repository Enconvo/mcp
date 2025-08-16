import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { OAuthClient, ProtectedResourceMetadata } from "./oauth-client.js";
import { TokenManager, StoredToken } from "./token-manager.js";
import { spawn } from "child_process";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface OAuthConfig {
  enabled: boolean;
  client_id?: string;
  client_secret?: string;
  redirect_uri?: string;
  scope?: string;
  auto_register?: boolean;
}

export class OAuthTransportFactory {
  private oauthClient: OAuthClient;
  private tokenManager: TokenManager;

  constructor() {
    this.oauthClient = new OAuthClient();
    this.tokenManager = new TokenManager();
  }

  async initialize(): Promise<void> {
    await this.tokenManager.loadTokens();
    // Clean up expired tokens on initialization
    await this.tokenManager.clearExpiredTokens();
  }

  async createHttpTransport(
    url: URL,
    headers: Record<string, string> = {},
    oauthConfig?: OAuthConfig
  ): Promise<Transport> {
    if (!oauthConfig?.enabled) {
      // Return regular HTTP transport without OAuth
      return new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
      });
    }

    try {
      const accessToken = await this.getOrObtainAccessToken(url.toString(), oauthConfig);
      
      // Add Authorization header with Bearer token
      const authHeaders = {
        ...headers,
        'Authorization': `Bearer ${accessToken}`,
      };

      return new StreamableHTTPClientTransport(url, {
        requestInit: { headers: authHeaders },
      });
    } catch (error) {
      console.error('Failed to create OAuth HTTP transport:', error);
      throw new Error(`OAuth authentication failed: ${error}`);
    }
  }

  async createSSETransport(
    url: URL,
    headers: Record<string, string> = {},
    oauthConfig?: OAuthConfig
  ): Promise<Transport> {
    if (!oauthConfig?.enabled) {
      // Return regular SSE transport without OAuth
      return new SSEClientTransport(url, {
        requestInit: { headers },
      });
    }

    try {
      const accessToken = await this.getOrObtainAccessToken(url.toString(), oauthConfig);
      
      // Add Authorization header with Bearer token
      const authHeaders = {
        ...headers,
        'Authorization': `Bearer ${accessToken}`,
      };

      return new SSEClientTransport(url, {
        requestInit: { headers: authHeaders },
      });
    } catch (error) {
      console.error('Failed to create OAuth SSE transport:', error);
      throw new Error(`OAuth authentication failed: ${error}`);
    }
  }

  private async getOrObtainAccessToken(resourceUrl: string, oauthConfig: OAuthConfig): Promise<string> {
    try {
      // Step 1: Discover protected resource metadata
      const resourceMetadata = await this.discoverResourceMetadata(resourceUrl);
      
      // Step 2: Select authorization server (use first one for now)
      const authServerUrl = resourceMetadata.authorization_servers[0];
      
      // Step 3: Discover authorization server metadata
      const authServerMetadata = await this.oauthClient.discoverAuthorizationServer(authServerUrl);
      
      // Step 4: Get or register client credentials
      let clientId = oauthConfig.client_id;
      if (!clientId) {
        if (oauthConfig.auto_register && authServerMetadata.registration_endpoint) {
          const credentials = await this.oauthClient.registerDynamicClient(
            authServerMetadata.registration_endpoint,
            {
              redirect_uris: [oauthConfig.redirect_uri || 'http://localhost:8080/callback'],
            }
          );
          clientId = credentials.client_id;
        } else {
          throw new Error('No client_id provided and auto_register is disabled');
        }
      }

      // Step 5: Check for existing valid token
      const existingToken = await this.tokenManager.getValidToken(
        resourceUrl,
        clientId,
        authServerUrl
      );

      if (existingToken) {
        console.log('Using existing valid token');
        return existingToken.access_token;
      }

      // Step 6: Check for refresh token
      const expiredToken = await this.tokenManager.getValidToken(resourceUrl, clientId, authServerUrl);
      if (expiredToken?.refresh_token) {
        try {
          console.log('Attempting to refresh token');
          const newToken = await this.oauthClient.refreshToken(
            authServerMetadata.token_endpoint,
            expiredToken.refresh_token,
            clientId,
            resourceUrl
          );
          
          await this.tokenManager.updateToken(resourceUrl, clientId, authServerUrl, newToken);
          return newToken.access_token;
        } catch (error) {
          console.warn('Token refresh failed, will request new authorization:', error);
          await this.tokenManager.removeToken(resourceUrl, clientId, authServerUrl);
        }
      }

      // Step 7: Perform authorization flow
      console.log('Starting OAuth authorization flow');
      const accessToken = await this.performAuthorizationFlow(
        authServerMetadata,
        clientId,
        resourceUrl,
        oauthConfig
      );

      return accessToken;

    } catch (error) {
      console.error('Failed to obtain access token:', error);
      throw error;
    }
  }

  private async discoverResourceMetadata(resourceUrl: string): Promise<ProtectedResourceMetadata> {
    try {
      // First try to get metadata directly
      return await this.oauthClient.discoverProtectedResourceMetadata(resourceUrl);
    } catch (error) {
      // If direct discovery fails, try making a request to trigger 401
      try {
        const response = await fetch(resourceUrl);
        if (response.status === 401) {
          const wwwAuth = response.headers.get('www-authenticate');
          if (wwwAuth) {
            const metadataUrl = this.extractMetadataUrlFromWwwAuth(wwwAuth);
            if (metadataUrl) {
              const metadataResponse = await fetch(metadataUrl);
              if (metadataResponse.ok) {
                return await metadataResponse.json();
              }
            }
          }
        }
      } catch (fetchError) {
        console.warn('Failed to trigger 401 discovery:', fetchError);
      }
      
      throw new Error(`Failed to discover protected resource metadata for ${resourceUrl}`);
    }
  }

  private extractMetadataUrlFromWwwAuth(wwwAuthHeader: string): string | null {
    // Parse WWW-Authenticate header to extract metadata URL
    // Example: Bearer realm="https://example.com", resource_metadata="https://example.com/.well-known/oauth-protected-resource"
    const metadataMatch = wwwAuthHeader.match(/resource_metadata="([^"]+)"/);
    return metadataMatch ? metadataMatch[1] : null;
  }

  private async performAuthorizationFlow(
    authServerMetadata: any,
    clientId: string,
    resourceUrl: string,
    oauthConfig: OAuthConfig
  ): Promise<string> {
    // Generate PKCE parameters
    const { codeVerifier, codeChallenge } = this.oauthClient.generatePKCE();
    
    // Build authorization URL
    const redirectUri = oauthConfig.redirect_uri || 'http://localhost:8080/callback';
    const { url: authUrl, state } = this.oauthClient.buildAuthorizationUrl(
      authServerMetadata.authorization_endpoint,
      clientId,
      redirectUri,
      resourceUrl,
      codeChallenge,
      oauthConfig.scope
    );

    console.log('Opening browser for authorization...');
    console.log('Authorization URL:', authUrl);

    // Open browser (this is simplified - in a real implementation you might want a better approach)
    await this.openBrowser(authUrl);

    // Start local server to handle callback
    const authCode = await this.handleAuthorizationCallback(redirectUri, state);

    // Exchange authorization code for access token
    const tokenResponse = await this.oauthClient.exchangeCodeForToken(
      authServerMetadata.token_endpoint,
      authCode,
      codeVerifier,
      clientId,
      redirectUri,
      resourceUrl
    );

    // Store the token
    await this.tokenManager.storeToken(
      tokenResponse,
      resourceUrl,
      clientId,
      authServerMetadata.issuer
    );

    return tokenResponse.access_token;
  }

  private async openBrowser(url: string): Promise<void> {
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
      command = 'open';
    } else if (platform === 'win32') {
      command = 'start';
    } else {
      command = 'xdg-open';
    }

    return new Promise((resolve, reject) => {
      const child = spawn(command, [url], { stdio: 'ignore', detached: true });
      child.unref();
      
      child.on('error', (error) => {
        console.warn('Failed to open browser automatically:', error);
        console.log('Please manually open this URL in your browser:', url);
        resolve();
      });
      
      child.on('close', () => {
        resolve();
      });
      
      // Resolve immediately since we don't need to wait for the browser
      setTimeout(resolve, 1000);
    });
  }

  private async handleAuthorizationCallback(redirectUri: string, expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const http = require('http');
      const url = require('url');
      
      const server = http.createServer((req: any, res: any) => {
        const parsedUrl = url.parse(req.url, true);
        
        if (parsedUrl.pathname === '/callback') {
          const { code, state, error } = parsedUrl.query;
          
          res.writeHead(200, { 'Content-Type': 'text/html' });
          
          if (error) {
            res.end(`<html><body><h1>Authorization Error</h1><p>${error}</p></body></html>`);
            server.close();
            reject(new Error(`Authorization error: ${error}`));
            return;
          }
          
          if (state !== expectedState) {
            res.end('<html><body><h1>Error</h1><p>Invalid state parameter</p></body></html>');
            server.close();
            reject(new Error('Invalid state parameter'));
            return;
          }
          
          if (!code) {
            res.end('<html><body><h1>Error</h1><p>No authorization code received</p></body></html>');
            server.close();
            reject(new Error('No authorization code received'));
            return;
          }
          
          res.end('<html><body><h1>Authorization Successful</h1><p>You can close this window.</p></body></html>');
          server.close();
          resolve(code as string);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
      
      // Extract port from redirect URI
      const redirectUrl = new URL(redirectUri);
      const port = parseInt(redirectUrl.port) || 8080;
      
      server.listen(port, 'localhost', () => {
        console.log(`Callback server listening on http://localhost:${port}/callback`);
      });
      
      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Authorization timeout'));
      }, 5 * 60 * 1000);
    });
  }

  async getTokenManager(): Promise<TokenManager> {
    return this.tokenManager;
  }

  async clearTokens(): Promise<void> {
    await this.tokenManager.clearAllTokens();
  }
}