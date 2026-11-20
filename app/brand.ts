/**
 * Agency branding for the embedded app. Edit this file (or set the env vars) to
 * match the Discoverable identity. Embedded Shopify apps can't recolour Polaris,
 * so branding shows up in the header banner, copy, contact card and app icon.
 */
export const brand = {
  agency: "Discoverable",
  appName: "Discoverable Connector",
  tagline: "eCommerce marketing agency · SEO, PPC & data",
  website: "https://discoverable.co.uk",
  // Taken from discoverable.co.uk: theme "black" is hsl(180, 94%, 13%), a dark teal.
  accent: process.env.BRAND_ACCENT || "#024141",
  accentText: process.env.BRAND_ACCENT_TEXT || "#ffffff",
  // White logo from the Discoverable site. Better to host a copy yourself (e.g. in /public) so a
  // Squarespace change can't break it, then point BRAND_LOGO_URL at that.
  logoUrl:
    process.env.BRAND_LOGO_URL ||
    "https://images.squarespace-cdn.com/content/v1/63078fb25edd2d0fee221e69/a9f0acfd-4405-4a7b-baf7-667deb2d49cf/discoverable-logo-white.png?format=750w",
  contactEmail: process.env.BRAND_CONTACT_EMAIL || "",
  bookingUrl: process.env.BRAND_BOOKING_URL || "",
};
