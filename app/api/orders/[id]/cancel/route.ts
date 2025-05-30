// app/api/orders/[id]/cancel/route.ts
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrderStatus } from "@prisma/client";
import { updateOrdersCache } from "@/app/lib/utils";
import { stripe } from "@/lib/stripe";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Get the order ID from the request body first, fall back to URL param
  let orderId: string;
  try {
    const body = await request.json();
    orderId = body.id || params.id; // Prefer the ID from the request body
  } catch (error) {
    orderId = params.id;
  }

  if (!orderId) {
    return NextResponse.json({ error: "Order ID missing" }, { status: 400 });
  }

  console.log("Attempting to cancel order:", orderId);

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Check if order can be canceled
    if (order.status === OrderStatus.COMPLETED) {
      return NextResponse.json(
        { error: "Cannot cancel a completed order" },
        { status: 400 }
      );
    }
    if (order.status === OrderStatus.CANCELED) {
      return NextResponse.json(
        { error: "Order is already canceled" },
        { status: 400 }
      );
    }

    // --- Payment Cancellation/Refund Logic ---
    if (order.paymentIntentId) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          order.paymentIntentId
        );

        if (paymentIntent.status === "requires_capture") {
          console.log(
            `Canceling Payment Intent ${order.paymentIntentId} (status: requires_capture)`
          );
          await stripe.paymentIntents.cancel(order.paymentIntentId);
        } else if (paymentIntent.status === "succeeded") {
          console.log(
            `Refunding Payment Intent ${order.paymentIntentId} (status: succeeded)`
          );
          // Check if already refunded
          const existingRefunds = await stripe.refunds.list({
            payment_intent: order.paymentIntentId,
            limit: 1,
          });
          if (existingRefunds.data.length === 0) {
            await stripe.refunds.create({
              payment_intent: order.paymentIntentId,
              reason: "requested_by_customer", // Or 'merchant_canceled'
            });
            // TODO: Store refund details in Prisma Order model if needed
          } else {
            console.log(
              `Payment Intent ${order.paymentIntentId} already refunded.`
            );
          }
        } else {
          console.log(
            `Payment Intent ${order.paymentIntentId} is in status ${paymentIntent.status}, no cancel/refund action taken.`
          );
        }
      } catch (stripeError: any) {
        console.error(
          `Stripe error during cancel/refund for PI ${order.paymentIntentId}:`,
          stripeError
        );
        // Decide if you should still cancel the order in your system
      }
    } else {
      console.warn(
        `No Payment Intent ID found for order ${orderId}, cannot cancel/refund payment.`
      );
    }

    // --- Delivery Cancellation Logic ---
    if (order.deliveryId) {
      try {
        console.log(
          `Attempting to cancel delivery ${order.deliveryId} for order ${orderId}`
        );
        // await cancelUberDelivery(order.deliveryId); // Replace with your actual Uber cancel function
        // Placeholder: Log that cancellation is needed
        console.log(
          `TODO: Implement cancellation for Uber delivery ID: ${order.deliveryId}`
        );
      } catch (deliveryCancelError: any) {
        console.error(
          `Failed to cancel delivery ${order.deliveryId}:`,
          deliveryCancelError
        );
        // Log error but continue canceling the order in your system
      }
    }

    // Update order status to canceled in DB
    const canceledOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELED,
        paymentStatus: "canceled", // Or 'refunded' based on logic above
        updatedAt: new Date(),
      },
    });

    // Update orders in Redis cache
    await updateOrdersCache();

    return NextResponse.json(canceledOrder);
  } catch (error: any) {
    console.error(`Failed to cancel order ${orderId}:`, error);
    return NextResponse.json(
      { error: `Failed to cancel order: ${error.message}` },
      { status: 500 }
    );
  }
}
