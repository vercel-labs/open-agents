import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Authorize CLI",
  description: "Authorize the Open Harness CLI with your verification code.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
