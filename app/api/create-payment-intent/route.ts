// app/api/create-payment-intent/route.ts
import { stripe } from "@/lib/stripe";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { updateOrdersCache, parseDeliveryAddress } from "@/app/lib/utils";
import { getUberAuthToken, getUberDeliveryQuotes } from "@/lib/uber";
import { CartItem, OrderStatus } from "@prisma/client";

interface CartItemWithModifiers {
  id: string;
  name: string;
  price: number;
  quantity: number;
  modifiers?: Array<{ price: number }>;
  notes?: string;
}

// Helper to calculate totals and prepare item data
function calculateTotals(cartItems: CartItemWithModifiers[]) {
  let subtotal = 0;

  for (const item of cartItems) {
    // Calculate item cost
    const itemTotal = item.price * item.quantity;
    subtotal += itemTotal;

    // Add modifier costs
    if (item.modifiers && Array.isArray(item.modifiers)) {
      for (const mod of item.modifiers) {
        subtotal += mod.price * item.quantity;
      }
    }
  }

  const tax = subtotal * 0.08; // 8% tax
  return { subtotal, tax };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      cartItems,
      deliveryType,
      deliveryAddress,
      deliveryApt,
      deliveryInstructions,
      recipientFirstName,
      recipientLastName,
      recipientPhone,
      siteId, // Store ID from the client
    } = body;

    if (!cartItems || cartItems.length === 0) {
      return NextResponse.json(
        { error: "Cart items are required" },
        { status: 400 }
      );
    }

    // Default values
    let tipAmount = body.tipAmount || 0;
    let deliveryFee = 0;
    let deliveryQuoteId = null;

    // Get delivery quote if applicable
    if (deliveryType === "delivery" && deliveryAddress) {
      try {
        // Store address (this should come from your store database normally)
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
          deliveryFee = deliveryQuote.fee / 100; // Convert cents to dollars
          deliveryQuoteId = deliveryQuote.id;
        }
      } catch (err) {
        console.error("Error creating delivery quote:", err);
        // Continue with zero delivery fee rather than failing
        deliveryFee = 0;
      }
    }

    // Calculate totals in dollars (not cents)
    const { subtotal, tax } = calculateTotals(cartItems);
    const total = subtotal + tax + tipAmount + deliveryFee;

    // Convert total to cents for Stripe
    const amountInCents = Math.round(total * 100);

    if (amountInCents <= 0) {
      return NextResponse.json(
        { error: "Order total must be positive" },
        { status: 400 }
      );
    }

    // Prepare cart items for metadata (stringify to avoid size limits)
    const cartItemsForMetadata = cartItems.map(
      (item: CartItemWithModifiers) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        modifiers: item.modifiers || [],
        notes: item.notes || "",
      })
    );

    // Create payment intent with complete metadata
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      capture_method: "manual", // Important for the webhook flow
      // confirmation_method: "manual",
      metadata: {
        cartItems: JSON.stringify(cartItemsForMetadata),
        deliveryFee: deliveryFee.toString(),
        tipAmount: tipAmount.toString(),
        subtotal: subtotal.toString(),
        tax: tax.toString(),
        total: total.toString(),
        deliveryAddress: deliveryAddress || "",
        deliveryInstructions: deliveryInstructions || "",
        recipientFirstName: recipientFirstName || "",
        recipientLastName: recipientLastName || "",
        recipientPhone: recipientPhone || "",
        deliveryQuoteId: deliveryQuoteId || "",
        storeId: siteId || "", // Pass the site ID as store ID
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
