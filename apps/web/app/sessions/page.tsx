import type { Metadata } from "next";
import { SessionsIndexShell } from "./sessions-index-shell";

export const metadata: Metadata = {
  title: "Sessions",
  description: "View and manage your sessions.",
};

export default function SessionsPage() {
  return <SessionsIndexShell />;
}
