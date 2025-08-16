import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OAuthClient } from "./oauth-client.js";
import { TokenManager } from "./token-manager.js";
import { OAuthTransportFactory } from "./oauth-http-transport.js";

export default async function main() {
    console.log("Starting MCP OAuth integration tests...");

    try {
        // OAuth Components Test
        console.log("\n=== Testing OAuth Components ===");

        // Initialize OAuth components
        const oauthClient = new OAuthClient();
        const tokenManager = new TokenManager();
        const transportFactory = new OAuthTransportFactory();

        await tokenManager.loadTokens();
        await transportFactory.initialize();

        console.log("✅ OAuth components initialized successfully");

        // Test PKCE generation
        const { codeVerifier, codeChallenge } = oauthClient.generatePKCE();
        console.log("✅ PKCE parameters generated:");
        console.log(`   Code Verifier: ${codeVerifier.substring(0, 20)}...`);
        console.log(`   Code Challenge: ${codeChallenge.substring(0, 20)}...`);

        // Test with real MCP server
        const mcpServerUrl = "https://api.githubcopilot.com/mcp/";
        // const mcpServerUrl = "https://mcp.notion.com/mcp";
        console.log(`🔍 Testing OAuth discovery with real MCP server: ${mcpServerUrl}`);

        // Test protected resource metadata discovery
        try {
            console.log("📡 Attempting to discover protected resource metadata...");
            const resourceMetadata = await oauthClient.discoverProtectedResourceMetadata(mcpServerUrl);
            console.log("✅ Protected resource metadata discovered:");
            console.log(`   Resource: ${resourceMetadata.resource}`);
            console.log(`   Authorization Servers: ${resourceMetadata.authorization_servers.join(', ')}`);

            // Test authorization server discovery
            if (resourceMetadata.authorization_servers.length > 0) {
                const authServerUrl = resourceMetadata.authorization_servers[0];
                console.log(`📡 Attempting to discover authorization server metadata from: ${authServerUrl}`);

                try {
                    const authServerMetadata = await oauthClient.discoverAuthorizationServer(authServerUrl);
                    console.log("✅ Authorization server metadata discovered:");
                    console.log(`   Issuer: ${authServerMetadata.issuer}`);
                    console.log(`   Authorization Endpoint: ${authServerMetadata.authorization_endpoint}`);
                    console.log(`   Token Endpoint: ${authServerMetadata.token_endpoint}`);
                    console.log(`   PKCE Methods: ${authServerMetadata.code_challenge_methods_supported?.join(', ')}`);

                    // Test authorization URL building with real endpoints
                    const { url: authUrl, state } = oauthClient.buildAuthorizationUrl(
                        authServerMetadata.authorization_endpoint,
                        "test-client-id",
                        "http://localhost:54535/callback",
                        mcpServerUrl,
                        codeChallenge,
                        "read write"
                    );

                    console.log("✅ Real authorization URL built:");
                    console.log(`   URL: ${authUrl}`);
                    console.log(`   State: ${state}`);

                } catch (authDiscoveryError) {
                    console.log(`ℹ️  Authorization server discovery failed: ${(authDiscoveryError as Error).message}`);
                    console.log("   This is expected if the server doesn't support OAuth or discovery endpoints are not accessible");
                }
            }

        } catch (resourceError) {
            console.log(`ℹ️  Protected resource discovery failed: ${(resourceError as Error).message}`);
            console.log("   This is expected if the MCP server doesn't support OAuth authentication");
        }



        const mcp = new Client({
            name: 'oauth-test',
            version: '0.0.1',
        });

        const url = mcpServerUrl; // Use the same server URL for consistency

        const transport = new StreamableHTTPClientTransport(new URL(url), {
            requestInit: {
                headers: {},
            },
        });

        mcp.onerror = (error) => {
            console.error('MCP connection error:', error);
        };

        mcp.onclose = () => {
            console.log('MCP connection closed');
        };

        try {
            console.log(`Attempting to connect to: ${url}`);
            await mcp.connect(transport);
            console.log("✅ MCP connection successful");

            // Try to list tools
            try {
                const tools = await mcp.listTools();
                console.log(`✅ Found ${tools.tools?.length || 0} tools`);
            } catch (toolError) {
                console.log("ℹ️  Could not list tools (may require authentication)");
            }

            mcp.close();
        } catch (error) {
            console.log("ℹ️  MCP connection failed (expected for protected servers):", (error as Error).message);
        }

        return "OAuth integration test completed successfully";

    } catch (error) {
        console.error("❌ OAuth test failed:", error);
        return `OAuth test failed: ${(error as Error).message}`;
    }
}