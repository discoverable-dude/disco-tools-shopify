/**
 * Agency branding for the embedded app. Edit this file (or set the env vars) to
 * match the Discoverable identity. Embedded Shopify apps can't recolour Polaris,
 * so branding shows up in the header banner, copy, contact card and app icon.
 */
export const brand = {
  agency: "Discoverable",
  appName: "Discoverable Connector",
  tagline: "Search, ads and store performance in one place",
  website: "https://discoverable.co.uk",
  // Header banner colours. Replace with the Discoverable brand hex values.
  accent: process.env.BRAND_ACCENT || "#111827",
  accentText: process.env.BRAND_ACCENT_TEXT || "#ffffff",
  // Optional. Hosted logo (white/light version for the dark banner). Leave empty to show the name.
  logoUrl: process.env.BRAND_LOGO_URL || "",
  contactEmail: process.env.BRAND_CONTACT_EMAIL || "",
  bookingUrl: process.env.BRAND_BOOKING_URL || "",
};
