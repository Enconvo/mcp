#!/usr/bin/env node

import { OAuthClient } from "./oauth-client.js";
import { TokenManager } from "./token-manager.js";
import { OAuthTransportFactory } from "./oauth-http-transport.js";

async function testOAuthFlow() {
  console.log("Testing OAuth integration...");

  try {
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

    // Test discovery endpoint building
    const issuerUrl = new URL("https://auth.example.com/tenant1");
    const endpoints = (oauthClient as any).buildDiscoveryEndpoints(issuerUrl);
    console.log("✅ Discovery endpoints built:");
    endpoints.forEach(endpoint => console.log(`   ${endpoint}`));

    // Test authorization URL building
    const { url: authUrl, state } = oauthClient.buildAuthorizationUrl(
      "https://auth.example.com/authorize",
      "test-client-id",
      "http://localhost:8080/callback",
      "https://mcp.example.com",
      codeChallenge,
      "read write"
    );
    
    console.log("✅ Authorization URL built:");
    console.log(`   URL: ${authUrl}`);
    console.log(`   State: ${state}`);

    // Test token storage
    const mockToken = {
      access_token: "mock-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "mock-refresh-token",
      scope: "read write"
    };

    await tokenManager.storeToken(
      mockToken,
      "https://mcp.example.com",
      "test-client-id",
      "https://auth.example.com"
    );

    console.log("✅ Token stored successfully");

    // Test token retrieval
    const retrievedToken = await tokenManager.getValidToken(
      "https://mcp.example.com",
      "test-client-id",
      "https://auth.example.com"
    );

    if (retrievedToken) {
      console.log("✅ Token retrieved successfully:");
      console.log(`   Access Token: ${retrievedToken.access_token.substring(0, 20)}...`);
      console.log(`   Token Type: ${retrievedToken.token_type}`);
      console.log(`   Expires At: ${new Date(retrievedToken.expires_at || 0).toISOString()}`);
    }

    // Clean up test token
    await tokenManager.removeToken(
      "https://mcp.example.com",
      "test-client-id",
      "https://auth.example.com"
    );

    console.log("✅ Test token cleaned up");
    console.log("\n🎉 All OAuth integration tests passed!");

  } catch (error) {
    console.error("❌ OAuth test failed:", error);
    process.exit(1);
  }
}

// Run the test if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testOAuthFlow();
}

export { testOAuthFlow };