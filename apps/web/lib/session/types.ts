export interface Session {
  created: number;
  authProvider: "vercel" | "github";
  user: {
    id: string;
    username: string;
    email: string | undefined;
    avatar: string;
    name?: string;
  };
}

export interface SessionUserInfo {
  user: Session["user"] | undefined;
  authProvider?: "vercel" | "github";
  hasGitHub?: boolean;
  hasGitHubAccount?: boolean;
  hasGitHubInstallations?: boolean;
}
