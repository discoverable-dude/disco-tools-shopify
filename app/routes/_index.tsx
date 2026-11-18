import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// Shopify opens the app at "/" with ?shop=...; hand off to the embedded app route.
export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  throw redirect(`/app${url.search}`);
};
