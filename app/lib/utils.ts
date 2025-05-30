import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";

export async function updateOrdersCache() {
  try {
    const orders = await prisma.order.findMany({
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });

    await redis.set("store_orders", JSON.stringify(orders));
    // Also set to "orders" for backward compatibility
    await redis.set("orders", JSON.stringify(orders));
  } catch (error) {
    console.error("Failed to update orders cache:", error);
  }
}

export function parseDeliveryAddress(
  addressString: string | null,
  apt?: string
) {
  // Default return for safety
  const defaultAddress = {
    street_address: ["", ""],
    state: "NY",
    city: "Rochester",
    zip_code: "14623",
    country: "US",
  };

  try {
    if (!addressString) return defaultAddress;

    // Parse address like "293 River Meadow Drive, Rochester, NY 14623, USA"
    const parts = addressString.split(",").map((part) => part.trim());
    if (parts.length < 3) return defaultAddress;

    const streetAddress = parts[0] || "";
    const city = parts[1] || "";
    const stateZipCode = parts[2] ? parts[2].split(" ") : [];
    const state = stateZipCode[0] || "";
    const zip_code = stateZipCode.length > 1 ? stateZipCode[1] : "";
    const country = parts.length > 3 ? parts[3] : "US";

    return {
      street_address: [streetAddress, apt || ""],
      state,
      city,
      zip_code,
      country: country === "USA" ? "US" : country,
    };
  } catch (error) {
    console.error("Error parsing address:", error);
    return defaultAddress;
  }
}
