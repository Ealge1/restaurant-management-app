// app/api/webhooks/stripe-webhook/route.ts
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { OrderStatus } from "@prisma/client";
import { validate as uuidValidate } from "uuid";
import { updateOrdersCache } from "@/lib/orders-cache";

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
        storeId = undefined;
      }
    } else {
      console.log("storeId is missing in metadata.");
      storeId = undefined;
    }

    const orderData = {
      orderNumber: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      status: OrderStatus.NEW,
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
      storeId: metadata.storeId,
      deliveryQuoteId: metadata.deliveryQuoteId,
      items: { create: orderItems },
    };

    console.log("Order data before Prisma create:", orderData);

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
      status: "CANCELED",
      paymentStatus: "failed",
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
      status: "CANCELED",
      paymentStatus: "canceled",
    },
  });
  await updateOrdersCache();
}
