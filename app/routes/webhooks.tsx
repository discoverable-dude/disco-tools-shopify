import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { recordAndDeliver } from "../outbox.server";
import { finishSync } from "../sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, session, webhookId } = await authenticate.webhook(request);

  switch (topic) {
    case "APP_UNINSTALLED":
      if (session) await db.session.deleteMany({ where: { shop } });
      await db.shopLink.updateMany({
        where: { shop },
        data: { status: "uninstalled", uninstalledAt: new Date() },
      });
      await recordAndDeliver(shop, topic, { shop }, webhookId);
      break;

    case "APP_SCOPES_UPDATE":
      if (session) {
        await db.session.update({
          where: { id: session.id },
          data: { scope: (payload.current as string[]).toString() },
        });
      }
      break;

    case "BULK_OPERATIONS_FINISH":
      // Shopify expects a response within 5s; the download/forward runs in the background.
      void finishSync(
        shop,
        payload.admin_graphql_api_id as string,
        String(payload.status).toLowerCase(),
      ).catch((e) => console.error("finishSync failed", e));
      break;

    // Compliance topics: forward so the platform can honour redact/export requests.
    default:
      await recordAndDeliver(shop, topic, payload, webhookId);
  }

  return new Response();
};
