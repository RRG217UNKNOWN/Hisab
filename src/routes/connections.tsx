import { createFileRoute, redirect } from "@tanstack/react-router";

// Connections management moved into the Requests page (a "Connections" tab
// alongside Sent/Received) so cross-org connecting and requesting live in
// one place. This route is kept only so old bookmarks/links don't 404.
export const Route = createFileRoute("/connections")({
  beforeLoad: () => {
    throw redirect({ to: "/requests" });
  },
});
