// lib/orders-cache.ts
//
// Shared helper for refreshing the Redis orders cache.
// Kept here (not inside an app/api/.../route.ts) because Next.js route
// files may only export HTTP method handlers (GET, POST, etc.).

import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

/**
 * Re-reads all orders from the database and writes them back into
 * the Redis cache under the key "store_orders".
 *
 * NOTE (tracked in Fix #5): this reads the entire orders table and
 * writes one giant key that mixes orders across all tenants. We'll
 * replace it with per-store scoping and pagination in a later fix.
 */
export async function updateOrdersCache() {
  try {
    const orders = await prisma.order.findMany({
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });

    await redis.set("store_orders", JSON.stringify(orders));
  } catch (error) {
    console.error("Failed to update orders cache:", error);
  }
}
