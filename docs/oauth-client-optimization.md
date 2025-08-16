# OAuth Client Discovery Optimization

## Overview

The `discoverProtectedResourceMetadata` method in `oauth-client.ts` has been significantly enhanced to support various OAuth server implementations, including GitHub Copilot's authentication pattern and other real-world scenarios.

## Key Improvements

### 1. Enhanced Discovery Strategy

The method now implements a comprehensive three-step discovery process:

#### Step 1: Direct Metadata Discovery
- Attempts standard RFC9728 discovery at `/.well-known/oauth-protected-resource`
- Most efficient when servers properly implement the standard
- Includes proper validation of authorization_servers field

#### Step 2: 401 Challenge Discovery
- Makes a request to trigger a 401 Unauthorized response
- Parses WWW-Authenticate header for `resource_metadata` parameter
- Supports complex header formats with multiple authentication parameters

#### Step 3: Fallback Path Discovery
- Tries multiple common metadata path variations
- Includes path-specific metadata URLs for endpoints like `/mcp`
- Example paths:
  ```
  /.well-known/oauth-protected-resource
  /.well-known/oauth-protected-resource/
  /.well-known/oauth-protected-resource/mcp/
  /.well-known/oauth-protected-resource/mcp/
  ```

### 2. Advanced WWW-Authenticate Header Parsing

#### GitHub Copilot Example
The enhanced parser now correctly handles complex headers like:
```
Bearer error="invalid_request", error_description="No access token was provided in this request", resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/"
```

#### Key Parsing Features
- **Multi-scheme Support**: Handles Bearer, Basic, and other authentication schemes
- **Parameter Extraction**: Robust parsing of quoted and unquoted values
- **Error Resilience**: Graceful handling of malformed headers
- **Debug Information**: Detailed logging of parsed parameters

### 3. Implementation Details

#### New Private Methods Added

```typescript
private extractMetadataUrlFromWwwAuth(wwwAuthHeader: string): string | null
private parseAuthChallenges(wwwAuthHeader: string): Array<{scheme: string, params: Map<string, string>}>
private parseWwwAuthParams(paramString: string): Map<string, string>
```

#### Enhanced Error Handling
- Detailed console logging for each discovery step
- Clear indication of which method succeeded
- Diagnostic information for failed attempts
- Meaningful error messages for troubleshooting

### 4. Real-World Compatibility

#### Supported Server Patterns

1. **Standard RFC9728 Servers**
   ```
   GET /.well-known/oauth-protected-resource
   → Direct metadata discovery
   ```

2. **GitHub Copilot Style**
   ```
   GET /mcp/ → 401 with WWW-Authenticate header
   → Extract metadata URL from header
   → Fetch metadata from extracted URL
   ```

3. **Path-Specific Servers**
   ```
   Resource: https://api.example.com/v1/mcp
   Metadata: https://api.example.com/.well-known/oauth-protected-resource/v1/mcp
   ```

## Code Architecture

### Centralized Discovery Logic
All enhanced discovery logic is now consolidated in the `OAuthClient` class, making it:
- **Reusable**: Can be used by any component needing resource discovery
- **Testable**: Easy to unit test without transport dependencies
- **Maintainable**: Single location for discovery logic updates

### Transport Factory Simplification
The `OAuthTransportFactory.discoverResourceMetadata` method now simply delegates to the enhanced OAuth client:

```typescript
private async discoverResourceMetadata(resourceUrl: string): Promise<ProtectedResourceMetadata> {
  return await this.oauthClient.discoverProtectedResourceMetadata(resourceUrl);
}
```

## Testing Enhancements

### Comprehensive Test Coverage
The test suite now includes:

1. **GitHub Copilot Header Parsing**
   ```typescript
   const githubCopilotHeader = 'Bearer error="invalid_request", error_description="No access token was provided in this request", resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/"';
   ```

2. **Multiple Header Format Testing**
   - Standard OAuth 2.0 headers
   - Error response headers
   - Multi-parameter headers

3. **Real Server Discovery Testing**
   - Tests against actual GitHub Copilot API
   - Fallback mechanism validation
   - Error case handling

## Benefits

### 1. Broader Server Compatibility
- Supports various OAuth server implementations
- Handles non-standard but common patterns
- Graceful fallback for edge cases

### 2. Robust Error Handling
- Detailed logging for debugging
- Clear error messages for configuration issues
- Multiple discovery attempts before failure

### 3. Standards Compliance
- Follows RFC9728 Protected Resource Metadata specification
- Implements OAuth 2.1 best practices
- Supports MCP Authorization specification requirements

### 4. Real-World Testing
- Verified with GitHub Copilot API
- Tested with various header formats
- Proven fallback mechanisms

## Usage Example

```typescript
const oauthClient = new OAuthClient();

try {
  // Enhanced discovery automatically handles:
  // 1. Direct metadata discovery
  // 2. 401 challenge parsing
  // 3. Path-specific fallbacks
  const metadata = await oauthClient.discoverProtectedResourceMetadata(
    "https://api.githubcopilot.com/mcp/"
  );
  
  console.log("Authorization servers:", metadata.authorization_servers);
} catch (error) {
  console.error("Discovery failed:", error.message);
}
```

## Migration Notes

### No Breaking Changes
- Existing implementations continue to work
- Enhanced functionality is transparent to existing code
- Backward compatibility maintained

### Performance Considerations
- Direct discovery is attempted first for optimal performance
- Fallback methods only used when necessary
- Detailed logging can be disabled in production if needed

This optimization ensures that the MCP OAuth client can successfully authenticate with a wide variety of OAuth-protected servers, from standards-compliant implementations to real-world services with custom patterns like GitHub Copilot.