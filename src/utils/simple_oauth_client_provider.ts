import { CommandManageUtils, PreferenceManageUtils } from "@enconvo/api";
import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthClientInformation, OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { exec } from "child_process";
import { URL } from "url";

export class SimpleOAuthClientProvider implements OAuthClientProvider {
  private _clientInformation?: OAuthClientInformationFull;
  private _tokens?: OAuthTokens;
  private _codeVerifier?: string;

  constructor(
    private readonly _redirectUrl: string | URL,
    private readonly _clientMetadata: OAuthClientMetadata
  ) { }

  get redirectUrl(): string | URL {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this._clientMetadata;
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    if (this._clientInformation) {
      return this._clientInformation;
    }
    if (!this.clientMetadata.client_name) {
      return undefined;
    }
    const clientInformationPreferenceValue = await CommandManageUtils.loadCommandConfig({
      commandKey: this.clientMetadata.client_name || "",
      includes: ['oauth_client_information']
    })
    if (!clientInformationPreferenceValue) {
      return undefined;
    }
    const clientInformantionText = clientInformationPreferenceValue.oauth_client_information
    if (!clientInformantionText) {
      return undefined;
    }
    try {
      const clientInformation = JSON.parse(clientInformantionText) as OAuthClientInformationFull;
      this._clientInformation = clientInformation;
      console.log("loaded clientInformation", clientInformation);
      return clientInformation;
    } catch (error) {
      console.error("parse clientInformation failed", error);
      return undefined;
    }
  }

  async saveClientInformation(clientInformation: OAuthClientInformationFull): Promise<void> {
    if (!this.clientMetadata.client_name) {
      return;
    }
    console.log("saveClientInformation", clientInformation);
    await PreferenceManageUtils.updatePreferences({
      updates: [{
        keys: ["oauth_client_information"],
        value: JSON.stringify(clientInformation),
        encrypt: true,
      }],
      preferenceKey: this.clientMetadata.client_name || "",
    })


    this._clientInformation = clientInformation;
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    if (this._tokens) {
      return this._tokens;
    }
    if (!this.clientMetadata.client_name) {
      return undefined;
    }

    const commandConfig = await CommandManageUtils.loadCommandConfig({
      commandKey: this.clientMetadata.client_name || "",
    })
    if (!commandConfig) {
      return undefined;
    }
    const tokens: OAuthTokens = {
      access_token: commandConfig.access_token,
      refresh_token: commandConfig.refresh_token,
      token_type: commandConfig.token_type,
      expires_in: commandConfig.expiry_date,
      scope: commandConfig.scope,
    };
    console.log("get tokens", this.clientMetadata.client_name, tokens);
    return tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    console.log("saveTokens", tokens);
    this._tokens = tokens;

    await PreferenceManageUtils.updatePreferences({
      updates: [{
        keys: ["refresh_token"],
        value: tokens.refresh_token,
        encrypt: true,
      },
      {
        keys: ["access_token"],
        value: tokens.access_token,
        encrypt: true,
      },
      {
        keys: ["token_type"],
        value: tokens.token_type,
        encrypt: false,
      },
      {
        keys: ["expiry_date"],
        value: tokens.expires_in,
        encrypt: false,
      },
      {
        keys: ["scope"],
        value: tokens.scope,
        encrypt: false,
      }
      ],
      preferenceKey: this.clientMetadata.client_name || "",
    })

  }

  /**
   * Opens the authorization URL in the user's default browser
   */
  private async openBrowser(url: string): Promise<void> {
    console.log(`🌐 Opening browser for authorization: ${url}`);

    const command = `open "${url}"`;

    exec(command, (error) => {
      if (error) {
        console.error(`Failed to open browser: ${error.message}`);
        console.log(`Please manually open: ${url}`);
      }
    });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    console.log(`Please visit this URL to authorize: ${authorizationUrl.toString()}`);
    this.openBrowser(authorizationUrl.toString());
  }

  saveCodeVerifier(codeVerifier: string): void {
    this._codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this._codeVerifier) {
      throw new Error('No code verifier saved');
    }
    return this._codeVerifier;
  }
}