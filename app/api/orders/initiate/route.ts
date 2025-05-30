// app/api/orders/initiate/route.ts
import { stripe } from "@/lib/stripe";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { Prisma, OrderStatus } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { updateOrdersCache, parseDeliveryAddress } from "@/app/lib/utils";
import { getUberAuthToken, getUberDeliveryQuotes } from "@/lib/uber";

// --- Helper Functions (Include implementations from previous responses) ---

// Function to parse address string

// Helper to calculate totals and prepare item data (Ensure price logic is correct: cents vs dollars)
async function calculateTotalsAndItems(
  cartItems: any[],
  tipInDollars: number,
  deliveryFeeInCents: number
): Promise<{
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  orderItemsData: any[];
}> {
  let subtotalCents = 0;
  const orderItemsData = [];

  for (const item of cartItems) {
    const itemPriceDollars = item.price || 0;
    const itemPriceCents = Math.round(itemPriceDollars * 100);
    const itemTotalCents = itemPriceCents * item.quantity;
    subtotalCents += itemTotalCents;

    const modifiers = item.modifiers || [];
    const modifierDetails = [];
    let modifierTotalCents = 0;

    for (const mod of modifiers) {
      const modPriceDollars = mod.price || 0;
      const modPriceCents = Math.round(modPriceDollars * 100);
      modifierTotalCents += modPriceCents * item.quantity;
      modifierDetails.push({ name: mod.name, price: modPriceDollars });
    }
    subtotalCents += modifierTotalCents;

    orderItemsData.push({
      name: item.name,
      quantity: item.quantity,
      price: itemPriceDollars, // Store base item price as dollars
      modifiers: modifierDetails, // Store selected modifiers as JSON
      notes: item.notes || null,
      itemId: item.id || null,
    });
  }

  const taxCents = Math.round(subtotalCents * 0.08); // 8% tax rate - ADJUST AS NEEDED
  const tipInCents = Math.round(tipInDollars * 100);
  const totalCents = subtotalCents + taxCents + tipInCents + deliveryFeeInCents;

  console.log(
    `Totals Calculated: Subtotal=${(subtotalCents / 100).toFixed(2)}, Tax=${(
      taxCents / 100
    ).toFixed(2)}, Tip=${(tipInCents / 100).toFixed(2)}, DeliveryFee=${(
      deliveryFeeInCents / 100
    ).toFixed(2)}, Total=${(totalCents / 100).toFixed(2)}`
  );

  return { subtotalCents, taxCents, totalCents, orderItemsData };
}

// Helper to find storeId (Adapt based on your store identification logic)
async function findStoreId(
  cartItems: any[],
  selectedLocation?: any
): Promise<string | null> {
  if (selectedLocation?.id) {
    // Assuming selectedLocation has a direct ID reference
    const locationRecord = await prisma.location.findUnique({
      where: { id: selectedLocation.id },
      select: { storeId: true },
    });
    if (locationRecord) return locationRecord.storeId;
  }
  // Fallback: Check first item's potential Stripe ID or internal ID
  if (cartItems.length > 0) {
    const firstItem = cartItems[0];
    let dbItem = null;
    if (firstItem.id) {
      // Check internal ID first
      dbItem = await prisma.item.findUnique({
        where: { id: firstItem.id },
        include: { user: { include: { store: true } } },
      });
    }
    // If not found by internal ID or no internal ID, try Stripe ID
    if (!dbItem && firstItem.stripePriceId) {
      try {
        const price = await stripe.prices.retrieve(firstItem.stripePriceId);
        const product = await stripe.products.retrieve(price.product as string);
        dbItem = await prisma.item.findFirst({
          where: { stripeProductId: product.id },
          include: { user: { include: { store: true } } },
        });
      } catch (err) {
        console.warn(
          `Could not find store via stripePriceId ${firstItem.stripePriceId}: ${err}`
        );
      }
    }
    if (dbItem?.user?.store?.id) {
      return dbItem.user.store.id;
    }
  }
  console.error("Failed to determine store ID for order.");
  return null;
}
// --- END HELPER FUNCTIONS ---

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      cartItems,
      tipAmount, // DOLLARS
      paymentMethodId, // From frontend
      deliveryType,
      selectedLocation,
      deliveryAddress,
      deliveryApt,
      deliveryInstructions,
      recipientFirstName,
      recipientLastName,
      recipientPhone,
      customerEmail, // Ensure this is passed from frontend
    } = body;

    // --- Basic Validations ---
    if (!cartItems || cartItems.length === 0)
      return NextResponse.json(
        { error: "Cart items are required" },
        { status: 400 }
      );
    if (!paymentMethodId)
      return NextResponse.json(
        { error: "Payment method ID is required" },
        { status: 400 }
      );
    if (tipAmount === undefined || tipAmount === null || isNaN(tipAmount))
      return NextResponse.json(
        { error: "Invalid tip amount provided" },
        { status: 400 }
      );

    // --- 1. Get Delivery Quote (if applicable) ---
    let deliveryQuote = null;
    let deliveryFeeInCents = 0;
    if (deliveryType === "delivery") {
      if (!deliveryAddress || !recipientPhone)
        return NextResponse.json(
          { error: "Delivery address and phone are required" },
          { status: 400 }
        );
      try {
        const pickupAddress = {
          street_address: ["376 Jefferson Rd", ""],
          state: "NY",
          city: "Rochester",
          zip_code: "14623",
          country: "US",
        }; // Use actual store address
        const dropoffAddress = parseDeliveryAddress(
          deliveryAddress,
          deliveryApt
        );
        if (!dropoffAddress.zip_code)
          return NextResponse.json(
            { error: "Valid delivery address with zip code is required" },
            { status: 400 }
          );
        const auth = await getUberAuthToken();
        if (!auth?.access_token)
          throw new Error("Failed to get Uber auth token");
        deliveryQuote = await getUberDeliveryQuotes({
          authToken: auth.access_token,
          pickupAddress,
          dropoffAddress,
        });
        if (deliveryQuote && typeof deliveryQuote.fee === "number") {
          deliveryFeeInCents = Math.round(deliveryQuote.fee);
        } else {
          console.warn("Could not retrieve valid delivery fee from Uber.");
          deliveryFeeInCents = 0;
        }
      } catch (deliveryError: any) {
        console.error("Error creating delivery quote:", deliveryError);
        return NextResponse.json(
          {
            error: "Failed to create delivery quote",
            details: deliveryError.message,
          },
          { status: 500 }
        );
      }
    }

    // --- 2. Calculate Totals & Prepare Item Data ---
    const { subtotalCents, taxCents, totalCents, orderItemsData } =
      await calculateTotalsAndItems(cartItems, tipAmount, deliveryFeeInCents);
    if (totalCents <= 0)
      return NextResponse.json(
        { error: "Order total must be positive" },
        { status: 400 }
      );

    // --- 3. Find Store ID ---
    const storeId = await findStoreId(cartItems, selectedLocation);
    if (!storeId)
      return NextResponse.json(
        { error: "Could not determine store for this order" },
        { status: 400 }
      );

    // --- 4. Create and Confirm Payment Intent ---
    let paymentIntent;
    try {
      console.log(
        `Creating and confirming Payment Intent with PM: ${paymentMethodId} for amount ${totalCents}`
      );
      paymentIntent = await stripe.paymentIntents.create({
        amount: totalCents,
        currency: "usd",
        payment_method: paymentMethodId,
        capture_method: "manual",
        confirm: true, // Attempt confirmation immediately
        // Setup future usage if needed:
        // setup_future_usage: 'off_session',
        metadata: {
          // Store minimal linking info + data potentially needed if order creation fails later
          storeId: storeId,
          customerName: `${recipientFirstName || ""} ${
            recipientLastName || ""
          }`.trim(),
          customerPhone: recipientPhone || null,
          // Storing line items here is redundant if order creation succeeds immediately after,
          // but acts as a fallback if DB write fails. Consider size limits.
          // lineItems: JSON.stringify(cartItems.map(i => ({id: i.id, qty: i.quantity}))), // Example: minimal items
        },
        // return_url is needed for scenarios like 3D Secure redirect
        return_url: `${
          process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
        }/order-confirmation`, // Use your confirmation page URL
      });
      console.log(
        `Payment Intent ${paymentIntent.id} created. Status: ${paymentIntent.status}`
      );
    } catch (error: any) {
      console.error(
        "Stripe Payment Intent creation/confirmation error:",
        error
      );
      let errorMessage = "Payment failed.";
      let errorCode = error.code;
      if (error.type === "StripeCardError") {
        errorMessage = error.message || "Card was declined.";
        errorCode = error.code || "card_declined";
      } else if (error.type === "StripeInvalidRequestError") {
        errorMessage = error.message || "Invalid payment details.";
        errorCode = error.code || "invalid_request";
      }
      // IMPORTANT: DO NOT CREATE ORDER if PI creation/confirmation fails here
      return NextResponse.json(
        { success: false, error: errorMessage, details: errorCode },
        { status: 402 }
      ); // 402 Payment Required or 400 Bad Request
    }

    // --- 5. Payment Intent Created - Create Order and Handle Status ---
    let order;
    try {
      const orderNumber = `ORD-${Date.now()}-${Math.floor(
        Math.random() * 100
      )}`;
      console.log(
        `Attempting to create order ${orderNumber} for PI ${paymentIntent.id} with status ${paymentIntent.status}`
      );

      order = await prisma.order.create({
        data: {
          orderNumber,
          status: OrderStatus.NEW, // Always start as NEW
          items: { create: orderItemsData },
          subtotal: subtotalCents / 100,
          tax: taxCents / 100,
          tip: tipAmount,
          deliveryFee: deliveryFeeInCents / 100,
          total: totalCents / 100,
          customerName: `${recipientFirstName || ""} ${
            recipientLastName || ""
          }`.trim(),
          customerPhone: recipientPhone || null,
          customerEmail: customerEmail || null, // Store email
          customerAddress: deliveryAddress || null,
          notes: deliveryInstructions || null,
          storeId: storeId,
          deliveryQuoteId: deliveryQuote?.id || null,
          paymentIntentId: paymentIntent.id, // Link the PI
          paymentStatus: paymentIntent.status, // Store the current PI status
          createdAt: new Date(paymentIntent.created * 1000), // Use PI creation time for consistency
        },
      });
      console.log(`Order ${order.id} created successfully in DB.`);
      await updateOrdersCache(); // Update cache only after successful DB write

      // --- 6. Return Response Based on PI Status ---
      if (paymentIntent.status === "requires_capture") {
        return NextResponse.json({
          success: true,
          orderId: order.id,
          paymentStatus: paymentIntent.status,
        });
      } else if (paymentIntent.status === "requires_action") {
        return NextResponse.json({
          success: false,
          requiresAction: true,
          clientSecret: paymentIntent.client_secret,
          orderId: order.id,
          paymentStatus: paymentIntent.status,
        });
      } else if (paymentIntent.status === "succeeded") {
        console.warn(
          `PI ${paymentIntent.id} succeeded immediately with manual capture.`
        );
        // Update payment status in DB just to be sure (though it was set during create)
        await prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: "succeeded" },
        });
        return NextResponse.json({
          success: true,
          orderId: order.id,
          paymentStatus: paymentIntent.status,
        });
      } else {
        // Should ideally not happen if PI creation succeeded, but handle defensively
        console.error(
          `Unexpected PI status after order creation: ${paymentIntent.status}`
        );
        await prisma.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELED,
            paymentStatus: paymentIntent.status || "failed_post_creation",
          },
        });
        await updateOrdersCache();
        return NextResponse.json(
          {
            success: false,
            error: `Unexpected payment status: ${paymentIntent.status}`,
          },
          { status: 500 }
        );
      }
    } catch (dbError: any) {
      console.error(
        `CRITICAL: Failed to create order ${
          order?.id || "N/A"
        } in DB after PI ${paymentIntent.id} created/confirmed:`,
        dbError
      );
      // Attempt to cancel the Payment Intent as the order wasn't saved
      try {
        console.log(
          `Attempting to cancel PI ${paymentIntent.id} due to DB error.`
        );
        await stripe.paymentIntents.cancel(paymentIntent.id);
        console.log(`PI ${paymentIntent.id} canceled successfully.`);
      } catch (cancelErr: any) {
        console.error(
          `CRITICAL: Failed to cancel PI ${paymentIntent.id} after DB error:`,
          cancelErr
        );
        // Log this critical state for manual reconciliation
      }
      return NextResponse.json(
        {
          success: false,
          error:
            "Failed to save order details after payment processing. Payment has been voided.",
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("Generic error in initiate order:", error);
    return NextResponse.json(
      {
        success: false,
        error: `An unexpected error occurred: ${error.message}`,
      },
      { status: 500 }
    );
  }
}
