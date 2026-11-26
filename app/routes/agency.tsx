import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// Shortcut: .../apps/<app>/agency opens the real page at /app/agency, keeping Shopify's query string.
export const loader = ({ request }: LoaderFunctionArgs) => {
  throw redirect(`/app/agency${new URL(request.url).search}`);
};
