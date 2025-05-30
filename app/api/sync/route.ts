// app/api/cart/route.ts
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getOrCreateSessionId } from "@/lib/session";
import { stripe } from "@/lib/stripe";
import { NextRequest, NextResponse } from "next/server";

async function syncItems() {
  const items = await prisma.item.findMany();

  for (const item of items) {
    if (!item.stripeProductId) {
      const product = await stripe.products.create({
        name: item.displayName || item.name || "Unnamed Product",
        description: item.description || undefined,
      });

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(item.price * 100),
        currency: "usd",
      });

      await prisma.item.update({
        where: { id: item.id },
        data: {
          stripeProductId: product.id,
          stripePriceId: price.id,
        },
      });
    }
  }

  console.log("done syncing items");
}

async function syncModifiers() {
  const modifiers = await prisma.modifier.findMany();

  for (const modifier of modifiers) {
    if (!modifier.stripeProductId) {
      const product = await stripe.products.create({
        name: modifier.name,
        description: modifier.description || undefined,
      });

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(modifier.price * 100),
        currency: "usd",
      });

      await prisma.modifier.update({
        where: { id: modifier.id },
        data: {
          stripeProductId: product.id,
          stripePriceId: price.id,
        },
      });
    }
  }

  console.log("done syncing modifiers");
}

// app/api/cart/route.ts
export async function GET(request: Request) {
  try {
    await syncItems();
    await syncModifiers();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update cart" },
      { status: 500 }
    );
  }
}
