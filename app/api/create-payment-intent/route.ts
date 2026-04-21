// app/api/create-payment-intent/route.ts
//
// Creates a Stripe Payment Intent for a cart.
//
// SECURITY NOTE: Prices are ALWAYS looked up from the database.
// We never trust prices sent by the browser. The client only tells us
// which items (by ID) and how many — the server decides the cost.

import { stripe } from "@/lib/stripe";
import { NextResponse } from "next/server";
import { getUberAuthToken, getUberDeliveryQuotes } from "@/lib/uber";
import { prisma } from "@/lib/prisma";
import { parseDeliveryAddress } from "@/lib/address";

// Tax rate — hardcoded for now. TODO: replace with Stripe Tax or per-store config.
const TAX_RATE = 0.08;

// ---- Types for the incoming request ----
// The browser sends ONLY ids, quantities, and selected modifier ids.
// No prices. No names. Those come from the database.
type IncomingCartItem = {
  id: string;                        // Item id
  quantity: number;
  modifierIds?: string[];            // Ids of selected modifiers
  notes?: string;
};

type IncomingBody = {
  cartItems: IncomingCartItem[];
  deliveryType?: "pickup" | "delivery";
  deliveryAddress?: string;
  deliveryApt?: string;
  deliveryInstructions?: string;
  recipientFirstName?: string;
  recipientLastName?: string;
  recipientPhone?: string;
  tipAmount?: number;                // Dollars, not cents
  siteId: string;                    // The store's id
};

// ---- Validation helpers ----
function isValidUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function sanitizeTip(tip: unknown): number {
  const n = typeof tip === "number" ? tip : 0;
  // Reject negative, NaN, and absurdly large tips (> $10,000)
  if (!Number.isFinite(n) || n < 0 || n > 10000) return 0;
  // Round to cents to avoid floating-point drift
  return Math.round(n * 100) / 100;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IncomingBody;
    const {
      cartItems,
      deliveryType,
      deliveryAddress,
      deliveryApt,
      deliveryInstructions,
      recipientFirstName,
      recipientLastName,
      recipientPhone,
      siteId,
    } = body;

    // ---- 1. Basic input validation ----
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return NextResponse.json(
        { error: "Cart is empty" },
        { status: 400 }
      );
    }
    if (cartItems.length > 100) {
      return NextResponse.json(
        { error: "Cart has too many items" },
        { status: 400 }
      );
    }
    if (!isValidUuid(siteId)) {
      return NextResponse.json(
        { error: "Invalid store id" },
        { status: 400 }
      );
    }

    // Validate each cart item shape before we hit the database
    for (const ci of cartItems) {
      if (!isValidUuid(ci.id)) {
        return NextResponse.json(
          { error: "Invalid item id in cart" },
          { status: 400 }
        );
      }
      if (
        !Number.isInteger(ci.quantity) ||
        ci.quantity < 1 ||
        ci.quantity > 99
      ) {
        return NextResponse.json(
          { error: "Invalid quantity. Must be between 1 and 99." },
          { status: 400 }
        );
      }
      if (ci.modifierIds && !Array.isArray(ci.modifierIds)) {
        return NextResponse.json(
          { error: "modifierIds must be an array" },
          { status: 400 }
        );
      }
      if (ci.modifierIds?.some((m) => !isValidUuid(m))) {
        return NextResponse.json(
          { error: "Invalid modifier id in cart" },
          { status: 400 }
        );
      }
    }

    const tipAmount = sanitizeTip(body.tipAmount);

    // ---- 2. Verify the store exists ----
    const store = await prisma.store.findUnique({
      where: { id: siteId },
      select: { id: true, name: true },
    });
    if (!store) {
      return NextResponse.json(
        { error: "Store not found" },
        { status: 404 }
      );
    }

    // ---- 3. Load every item + its allowed modifier groups from the database ----
    const itemIds = cartItems.map((ci) => ci.id);
    const itemsFromDb = await prisma.item.findMany({
      where: { id: { in: itemIds } },
      include: {
        modifierGroups: {
          include: { modifiers: true },
        },
      },
    });

    // Build a lookup: itemId -> item (with modifiers)
    const itemsById = new Map(itemsFromDb.map((i) => [i.id, i]));

    // Make sure every item the client asked for actually exists and is available
    for (const ci of cartItems) {
      const dbItem = itemsById.get(ci.id);
      if (!dbItem) {
        return NextResponse.json(
          { error: `Item no longer available` },
          { status: 400 }
        );
      }
      if (dbItem.isAvailable === false) {
        return NextResponse.json(
          { error: `"${dbItem.name}" is currently unavailable` },
          { status: 400 }
        );
      }
    }

    // ---- 4. Compute the subtotal using DATABASE prices only ----
    // This is the critical security step. We ignore anything the client
    // said about price. We look up the item, we look up its modifiers,
    // we add it up ourselves.
    let subtotal = 0;
    const validatedItemsForRecord: Array<{
      id: string;
      name: string;
      price: number;
      quantity: number;
      modifiers: Array<{ id: string; name: string; price: number }>;
      notes: string;
    }> = [];

    for (const ci of cartItems) {
      const dbItem = itemsById.get(ci.id)!; // safe: checked above

      // Build the set of allowed modifier ids for this item.
      // Modifiers are only valid if they belong to one of the item's
      // modifier groups AND are marked available.
      const allowedModifierIds = new Set<string>();
      const allowedModifiersById = new Map<
        string,
        { id: string; name: string; price: number }
      >();
      for (const group of dbItem.modifierGroups) {
        for (const mod of group.modifiers) {
          if (mod.isAvailable !== false) {
            allowedModifierIds.add(mod.id);
            allowedModifiersById.set(mod.id, {
              id: mod.id,
              name: mod.name,
              price: mod.price,
            });
          }
        }
      }

      // Validate the modifier ids the client sent
      const requestedModIds = ci.modifierIds ?? [];
      for (const modId of requestedModIds) {
        if (!allowedModifierIds.has(modId)) {
          return NextResponse.json(
            {
              error: `Invalid modifier for "${dbItem.name}"`,
            },
            { status: 400 }
          );
        }
      }

      // Sum: (item price + sum of modifier prices) * quantity
      const modifierSum = requestedModIds.reduce((sum, modId) => {
        const m = allowedModifiersById.get(modId)!;
        return sum + m.price;
      }, 0);

      const lineTotal = (dbItem.price + modifierSum) * ci.quantity;
      subtotal += lineTotal;

      validatedItemsForRecord.push({
        id: dbItem.id,
        name: dbItem.name,
        price: dbItem.price,
        quantity: ci.quantity,
        modifiers: requestedModIds.map(
          (id) => allowedModifiersById.get(id)!
        ),
        notes: typeof ci.notes === "string" ? ci.notes.slice(0, 500) : "",
      });
    }

    // ---- 5. Delivery fee (from Uber, if delivery) ----
    let deliveryFee = 0;
    let deliveryQuoteId: string | null = null;

    if (deliveryType === "delivery" && deliveryAddress) {
      try {
        // TODO: pull pickup address from Store.locations instead of hardcoding
        const pickupAddress = {
          street_address: ["376 Jefferson Rd", ""],
          state: "NY",
          city: "Rochester",
          zip_code: "14623",
          country: "US",
        };

        const dropoffAddress = parseDeliveryAddress(
          deliveryAddress,
          deliveryApt
        );
        if (!dropoffAddress.zip_code) {
          return NextResponse.json(
            { error: "Valid delivery address with zip code is required" },
            { status: 400 }
          );
        }

        const auth = await getUberAuthToken();
        if (!auth?.access_token) {
          throw new Error("Failed to get Uber auth token");
        }

        const deliveryQuote = await getUberDeliveryQuotes({
          authToken: auth.access_token,
          pickupAddress,
          dropoffAddress,
        });

        if (deliveryQuote && typeof deliveryQuote.fee === "number") {
          deliveryFee = deliveryQuote.fee / 100; // Uber returns cents
          deliveryQuoteId = deliveryQuote.id ?? null;
        }
      } catch (err) {
        console.error("Error creating delivery quote:", err);
        // Fall through with $0 delivery fee. TODO in a later fix: fail loudly.
        deliveryFee = 0;
      }
    }

    // ---- 6. Final total ----
    const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
    const total = subtotal + tax + tipAmount + deliveryFee;
    const amountInCents = Math.round(total * 100);

    if (amountInCents <= 0) {
      return NextResponse.json(
        { error: "Order total must be positive" },
        { status: 400 }
      );
    }

    // ---- 7. Create the Stripe Payment Intent ----
    // We only store small identifiers in metadata (500-char limit per value).
    // The full cart will be re-read from our DB by the webhook — or better,
    // from a PendingOrder row we'll add in Fix #2.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      capture_method: "manual",
      metadata: {
        storeId: store.id,
        subtotal: subtotal.toFixed(2),
        tax: tax.toFixed(2),
        tip: tipAmount.toFixed(2),
        deliveryFee: deliveryFee.toFixed(2),
        total: total.toFixed(2),
        deliveryType: deliveryType || "pickup",
        deliveryAddress: (deliveryAddress || "").slice(0, 400),
        deliveryInstructions: (deliveryInstructions || "").slice(0, 400),
        recipientFirstName: (recipientFirstName || "").slice(0, 100),
        recipientLastName: (recipientLastName || "").slice(0, 100),
        recipientPhone: (recipientPhone || "").slice(0, 50),
        deliveryQuoteId: deliveryQuoteId || "",
        // Cart items — compact form. Webhook can re-verify from DB if needed.
        cartItems: JSON.stringify(
          validatedItemsForRecord.map((i) => ({
            id: i.id,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            modifiers: i.modifiers,
            notes: i.notes,
          }))
        ).slice(0, 490), // hard cap to stay under Stripe's 500 limit
      },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
