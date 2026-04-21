// lib/address.ts
//
// Shared address-parsing helper.
// Kept here (not inside an app/api/... route file) because Next.js
// only allows specific exports from route files (GET, POST, etc.).

export type ParsedDeliveryAddress = {
  street_address: [string, string];
  state: string;
  city: string;
  zip_code: string;
  country: string;
};

/**
 * Parses a comma-separated address string like
 * "293 River Meadow Drive, Rochester, NY 14623, USA"
 * into the object shape our delivery providers expect.
 *
 * Falls back to a safe default if the string is missing or malformed.
 */
export function parseDeliveryAddress(
  addressString: string | undefined | null,
  apt?: string
): ParsedDeliveryAddress {
  const defaultAddress: ParsedDeliveryAddress = {
    street_address: ["", ""],
    state: "NY",
    city: "Rochester",
    zip_code: "14623",
    country: "US",
  };

  try {
    if (!addressString) return defaultAddress;

    const parts = addressString.split(", ");
    if (parts.length < 3) return defaultAddress;

    const streetAddress = parts[0] ?? "";
    const city = parts[1] ?? "";
    const stateCountryParts = (parts[2] ?? "").split(" ");
    const state = stateCountryParts[0] ?? "";
    const zipCode =
      stateCountryParts.length > 1 ? stateCountryParts[1] : "14623";
    const country = parts.length > 3 ? parts[3] : "US";

    return {
      street_address: [streetAddress, apt || ""],
      state,
      city,
      zip_code: zipCode,
      country: country === "USA" ? "US" : country,
    };
  } catch (error) {
    console.error("Error parsing address:", error);
    return defaultAddress;
  }
}
