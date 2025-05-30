import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { OrderStatus } from "@prisma/client"; // Import the OrderStatus enum
import { v4 as uuidv4, validate as uuidValidate } from "uuid"; // Import UUID validator
import { updateOrdersCache } from "@/app/lib/utils";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature")!;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      await req.text(),
      sig,
      webhookSecret
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  console.log("webby hooky baby", event);

  switch (event.type) {
    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(event.data.object);
      break;

    case "payment_intent.payment_failed":
      await handlePaymentIntentFailed(event.data.object);
      break;

    case "payment_intent.canceled":
      await handlePaymentIntentCanceled(event.data.object);
      break;

    case "payment_intent.amount_capturable_updated":
      await handlePaymentIntentAmountCapturableUpdated(event.data.object);
      break;
  }

  return NextResponse.json({ received: true });
}

async function handlePaymentIntentAmountCapturableUpdated(
  paymentIntent: Stripe.PaymentIntent
) {
  console.log(
    `Payment Intent ${paymentIntent.id} amount_capturable_updated to ${paymentIntent.amount_capturable}`
  );

  try {
    // Check for existing order
    const existingOrder = await prisma.order.findFirst({
      where: { paymentIntentId: paymentIntent.id },
    });

    if (existingOrder) {
      console.log(`Order already exists for PI: ${paymentIntent.id}`);
      return;
    }

    // Parse metadata
    const metadata = paymentIntent.metadata;
    console.log("Metadata before parsing:", metadata);
    const cartItemsString = metadata.cartItems || "[]";
    console.log("cartItemsString:", cartItemsString);

    let cartItems;
    try {
      cartItems = JSON.parse(cartItemsString);
      console.log("Parsed cartItems:", cartItems);
    } catch (jsonError: any) {
      console.error("Error parsing cartItems JSON:", jsonError.message);
      throw new Error(`Invalid cartItems JSON: ${jsonError.message}`);
    }

    const deliveryFee = parseFloat(metadata.deliveryFee || "0");
    const tipAmount = parseFloat(metadata.tipAmount || "0");

    // Calculate amounts
    const subtotal = cartItems.reduce((total: number, item: any) => {
      const itemTotal = item.price * item.quantity;
      const modifiersTotal = (item.modifiers || []).reduce(
        (sum: number, mod: any) => sum + mod.price * item.quantity,
        0
      );
      return total + itemTotal + modifiersTotal;
    }, 0);

    const tax = subtotal * 0.08;
    const total = subtotal + tax + tipAmount + deliveryFee;

    // Create order items
    const orderItems = cartItems.map((item: any) => ({
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      modifiers: JSON.stringify(item.modifiers || []),
      itemId: item.id || null,
      notes: item.notes || null,
    }));

    let storeId: string | undefined = metadata.storeId;

    // Validate storeId
    if (storeId) {
      if (!uuidValidate(storeId)) {
        console.error("Invalid storeId in metadata:", metadata.storeId);
        storeId = undefined; // Set to undefined if invalid
      }
    } else {
      console.log("storeId is missing in metadata.");
      storeId = undefined; // Set to undefined if missing
    }

    const orderData = {
      orderNumber: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      status: OrderStatus.NEW, // Use the enum value
      paymentIntentId: paymentIntent.id,
      paymentStatus: paymentIntent.status,
      subtotal,
      tax,
      tip: tipAmount,
      deliveryFee,
      total,
      customerName:
        `${metadata.recipientFirstName} ${metadata.recipientLastName}`.trim(),
      customerPhone: metadata.recipientPhone,
      customerEmail: metadata.customerEmail,
      customerAddress: metadata.deliveryAddress,
      notes: metadata.deliveryInstructions,
      storeId: metadata.storeId, // Use the validated storeId (can be undefined)
      deliveryQuoteId: metadata.deliveryQuoteId,
      items: { create: orderItems },
    };

    console.log("Order data before Prisma create:", orderData);

    // Create order
    const order = await prisma.order.create({
      data: orderData,
    });

    console.log(`Created order ${order.id} for PI ${paymentIntent.id}`);
    await updateOrdersCache();
  } catch (error: any) {
    if (error instanceof Error) {
      console.error("Order creation failed:", error.message);
    } else {
      console.error("An unknown error occurred during order creation:", error);
    }
    throw error;
  }
}

async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent
) {
  // Only update the existing order, don't create a new one
  await prisma.order.updateMany({
    where: { paymentIntentId: paymentIntent.id },
    data: {
      paymentStatus: paymentIntent.status,
    },
  });

  console.log(`Updated order status for PI ${paymentIntent.id}`);
  await updateOrdersCache();
}

async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
  console.log("Payment failed for order");
  await prisma.order.updateMany({
    where: { paymentIntentId: paymentIntent.id },
    data: {
      status: OrderStatus.CANCELED,
      paymentStatus: paymentIntent.status,
      notes: `Payment failed: ${paymentIntent.last_payment_error?.message}`,
    },
  });
  await updateOrdersCache();
}

async function handlePaymentIntentCanceled(
  paymentIntent: Stripe.PaymentIntent
) {
  await prisma.order.updateMany({
    where: { paymentIntentId: paymentIntent.id },
    data: {
      status: OrderStatus.CANCELED,
      paymentStatus: paymentIntent.status,
    },
  });
  await updateOrdersCache();
}

// Helper function to parse the address string into required object
function parseAddressString(addressString: string | null): {
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
} {
  const defaultAddress = {
    streetAddress: "",
    city: "",
    state: "",
    zipCode: "",
    country: "US",
  };

  if (!addressString) return defaultAddress;

  try {
    // Split the address string by commas and trim each part
    const parts = addressString.split(",").map((part) => part.trim());

    // Assuming the address string is in the format: "Street Address, City, State ZipCode, Country"
    const streetAddress = parts[0] || "";
    const city = parts[1] || "";

    // The last part is State ZipCode and Country, so we split that
    const stateZipCodeAndCountry = parts[2] ? parts[2].split(" ") : [];
    const state = stateZipCodeAndCountry[0] || ""; // E.g., "NY"
    const zipCode = stateZipCodeAndCountry[1] || ""; // E.g., "14623"
    const country = parts[3] || "US"; // Assuming it's US if not provided

    return {
      streetAddress,
      city,
      state,
      zipCode,
      country,
    };
  } catch (e) {
    console.error("Failed to parse address string:", addressString, e);
    return defaultAddress;
  }
}
