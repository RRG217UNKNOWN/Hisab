import { createFileRoute, redirect } from "@tanstack/react-router";

// Account's content (profile, organization, GST identity, sign-out) moved
// onto Settings so there's one place for account + preferences. Kept only
// so old bookmarks/links don't 404.
export const Route = createFileRoute("/account")({
  beforeLoad: () => {
    throw redirect({ to: "/settings" });
  },
});
