import type { Metadata } from "next";
import { ProfileSection } from "../profile-section";

export const metadata: Metadata = {
  title: "Profile",
  description: "Update your Open Harness profile details.",
};

export default function ProfilePage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Profile</h1>
      <ProfileSection />
    </>
  );
}
