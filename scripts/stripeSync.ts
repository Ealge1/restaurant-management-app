import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

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

async function main() {
  await syncItems();
  await syncModifiers();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
