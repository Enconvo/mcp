/**
 * Generate OAuth success page HTML
 */
export function generateOAuthSuccessPage(extensionName: string, commandName: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Successful - Enconvo</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: hsl(210 40% 98%);
      padding: 1rem;
    }
    
    .container {
      text-align: center;
      padding: 3rem 2.5rem;
      background: hsl(0 0% 100%);
      border-radius: 12px;
      border: 1px solid hsl(214.3 31.8% 91.4%);
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
      max-width: 420px;
      width: 100%;
      animation: slideUp 0.5s ease-out;
    }
    
    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .success-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 1.5rem;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      animation: pulse 2s ease-in-out infinite;
    }
    
    @keyframes pulse {
      0%, 100% {
        transform: scale(1);
        box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
      }
      50% {
        transform: scale(1.05);
        box-shadow: 0 0 0 20px rgba(16, 185, 129, 0);
      }
    }
    
    .checkmark {
      width: 40px;
      height: 40px;
      stroke: white;
      stroke-width: 3;
      fill: none;
      stroke-dasharray: 100;
      stroke-dashoffset: 100;
      animation: checkmark 0.8s ease-out 0.3s forwards;
    }
    
    @keyframes checkmark {
      to {
        stroke-dashoffset: 0;
      }
    }
    
    h1 { 
      color: hsl(222.2 84% 4.9%);
      font-size: 1.75rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
      letter-spacing: -0.025em;
    }
    
    .subtitle {
      color: hsl(215.4 16.3% 46.9%);
      font-size: 1.125rem;
      margin-bottom: 2rem;
      line-height: 1.5;
    }
    
    .details {
      background: hsl(210 40% 98%);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1.5rem;
      border: 1px solid hsl(214.3 31.8% 91.4%);
    }
    
    .details-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 0;
      font-size: 0.875rem;
    }
    
    .details-item:not(:last-child) {
      border-bottom: 1px solid hsl(214.3 31.8% 91.4%);
    }
    
    .details-label {
      color: hsl(215.4 16.3% 46.9%);
      font-weight: 500;
    }
    
    .details-value {
      color: hsl(222.2 84% 4.9%);
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 0.813rem;
    }
    
    .close-note {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: hsl(215.4 16.3% 46.9%);
      font-size: 0.875rem;
      margin-top: 1rem;
    }
    
    .footer-note {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid hsl(214.3 31.8% 91.4%);
      color: hsl(215.4 16.3% 46.9%);
      font-size: 0.75rem;
    }
    
    @media (max-width: 480px) {
      .container {
        padding: 2rem 1.5rem;
      }
      h1 {
        font-size: 1.5rem;
      }
      .subtitle {
        font-size: 1rem;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">
      <svg class="checkmark" viewBox="0 0 52 52">
        <path d="M14 27 L22 35 L38 16" />
      </svg>
    </div>
    
    <h1>Authentication Successful!</h1>
    <p class="subtitle">Your account has been connected to Enconvo</p>
    
    <div class="details">
      <div class="details-item">
        <span class="details-label">Extension</span>
        <span class="details-value">${extensionName}</span>
      </div>
      <div class="details-item">
        <span class="details-label">Command</span>
        <span class="details-value">${commandName}</span>
      </div>
      <div class="details-item">
        <span class="details-label">Status</span>
        <span class="details-value" style="color: hsl(142.1 76.2% 36.3%);">Connected</span>
      </div>
    </div>
    
    <div class="close-note">
      <span>You can safely close this window</span>
    </div>
    
    <div class="footer-note">
      You can now return to Enconvo and start using the connected service.
    </div>
  </div>
  
  <script>
    // Auto-close window after 3 seconds
    setTimeout(() => {
      window.close();
    }, 3000);
  </script>
</body>
</html>
  `.trim();
}

/**
 * Generate OAuth error page HTML
 */
export function generateOAuthErrorPage(error: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Failed - Enconvo</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: hsl(210 40% 98%);
      padding: 1rem;
    }
    
    .container {
      text-align: center;
      padding: 3rem 2.5rem;
      background: hsl(0 0% 100%);
      border-radius: 12px;
      border: 1px solid hsl(214.3 31.8% 91.4%);
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
      max-width: 420px;
      width: 100%;
      animation: slideUp 0.5s ease-out;
    }
    
    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .error-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 1.5rem;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .cross {
      width: 40px;
      height: 40px;
      stroke: white;
      stroke-width: 3;
      fill: none;
    }
    
    h1 { 
      color: hsl(222.2 84% 4.9%);
      font-size: 1.75rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
      letter-spacing: -0.025em;
    }
    
    .subtitle {
      color: hsl(215.4 16.3% 46.9%);
      font-size: 1.125rem;
      margin-bottom: 2rem;
      line-height: 1.5;
    }
    
    .error-details {
      background: hsl(0 100% 97%);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1.5rem;
      border: 1px solid hsl(0 100% 91%);
      color: hsl(0 74% 42%);
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 0.875rem;
      text-align: left;
    }
    
    .footer-note {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid hsl(214.3 31.8% 91.4%);
      color: hsl(215.4 16.3% 46.9%);
      font-size: 0.75rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">
      <svg class="cross" viewBox="0 0 24 24">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </div>
    
    <h1>Authentication Failed</h1>
    <p class="subtitle">Unable to connect your account to Enconvo</p>
    
    <div class="error-details">
      Error: ${error}
    </div>
    
    <div class="footer-note">
      Please try again or contact support if the problem persists.
    </div>
  </div>
</body>
</html>
  `.trim();
}