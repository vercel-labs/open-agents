import {
  clearCredentials,
  getCredentialsPath,
  loadCredentials,
} from "./credentials";
import {
  getWebUrl,
  openBrowser,
  startDeviceFlow,
  waitForAuthorization,
} from "./device-flow";

/**
 * Handle the login command - start device flow authentication
 */
export async function handleLogin(): Promise<void> {
  // Check if already logged in
  const existing = await loadCredentials();
  if (existing) {
    console.log(`Already logged in as ${existing.username}`);
    console.log('Run "openharness auth logout" to sign out first.');
    return;
  }

  console.log("Starting authentication...\n");

  try {
    // Start device flow
    const {
      deviceCode,
      userCode,
      verificationUriComplete,
      expiresIn,
      interval,
    } = await startDeviceFlow();

    console.log("Please visit the following URL to authorize this device:\n");
    console.log(`  ${verificationUriComplete}\n`);
    console.log(`Or visit ${getWebUrl()}/cli/auth and enter code:\n`);
    console.log(`  ${userCode}\n`);

    // Try to open browser
    const opened = await openBrowser(verificationUriComplete);
    if (opened) {
      console.log("Opening browser...\n");
    }

    console.log("Waiting for authorization...");

    // Poll for token
    const result = await waitForAuthorization(deviceCode, interval, expiresIn);

    switch (result.status) {
      case "success":
        console.log(`\nAuthenticated as ${result.credentials.username}`);
        console.log(`Credentials saved to ${getCredentialsPath()}`);
        break;

      case "expired":
        console.error("\nAuthentication timed out. Please try again.");
        process.exit(1);
        break;

      case "error":
        console.error(`\nAuthentication failed: ${result.error}`);
        process.exit(1);
        break;
    }
  } catch (error) {
    console.error(
      "Authentication error:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

/**
 * Handle the logout command - clear stored credentials
 */
export async function handleLogout(): Promise<void> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.log("Not currently logged in.");
    return;
  }

  await clearCredentials();
  console.log(`Logged out from ${credentials.username}`);
  console.log(`Credentials removed from ${getCredentialsPath()}`);
}

/**
 * Handle the status command - show current auth status
 */
export async function handleStatus(): Promise<void> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.log("Not logged in");
    console.log('Run "openharness auth login" to authenticate.');
    return;
  }

  console.log("Status: Authenticated");
  console.log(`User: ${credentials.username}`);
  console.log(`User ID: ${credentials.userId}`);

  if (credentials.expiresAt) {
    const expiresAt = new Date(credentials.expiresAt);
    const now = new Date();
    const daysRemaining = Math.ceil(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    console.log(
      `Token expires: ${expiresAt.toLocaleDateString()} (${daysRemaining} days)`,
    );
  }

  console.log(`Credentials: ${getCredentialsPath()}`);
}

/**
 * Handle the whoami command - show current user info
 */
export async function handleWhoami(): Promise<void> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.log("Not logged in");
    process.exit(1);
  }

  console.log(credentials.username);
}

/**
 * Print auth help
 */
export function printAuthHelp(): void {
  console.log("Usage: openharness auth <command>");
  console.log("");
  console.log("Commands:");
  console.log("  login   Authenticate with the Open Harness web app");
  console.log("  logout  Clear stored credentials");
  console.log("  status  Show current authentication status");
  console.log("  whoami  Print the current user's username");
  console.log("");
  console.log("Examples:");
  console.log("  openharness auth login");
  console.log("  openharness auth status");
}

/**
 * Handle auth subcommands
 * Returns { handled: true, exitCode: number } if the command was handled
 * Returns { handled: false } if no auth command was specified
 */
export async function handleAuthCommand(
  args: string[],
): Promise<{ handled: true; exitCode: number } | { handled: false }> {
  const subcommand = args[0];

  switch (subcommand) {
    case "login":
      await handleLogin();
      return { handled: true, exitCode: 0 };

    case "logout":
      await handleLogout();
      return { handled: true, exitCode: 0 };

    case "status":
      await handleStatus();
      return { handled: true, exitCode: 0 };

    case "whoami":
      await handleWhoami();
      return { handled: true, exitCode: 0 };

    case undefined:
    case "help":
    case "--help":
    case "-h":
      printAuthHelp();
      return { handled: true, exitCode: 0 };

    default:
      console.error(`Unknown auth command: ${subcommand}`);
      printAuthHelp();
      return { handled: true, exitCode: 1 };
  }
}
