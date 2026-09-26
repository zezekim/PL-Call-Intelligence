import { APP_VERSION, BUILD_ID } from "@/lib/version";

// Always answered by the running server, never a cache, so an open tab can
// tell when a newer build has been deployed.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { version: APP_VERSION, build: BUILD_ID },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
