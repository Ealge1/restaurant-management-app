// app/api/orders/[id]/edit/route.ts
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { updateOrdersCache } from "@/app/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { OrderStatus, Prisma } from "@prisma/client";

interface OrderItem {
  id?: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
  modifiers?: any[];
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { items, notes } = body;

    // Use id from body OR fallback to params.id
    const id = body.id || params.id;

    console.log(`Editing order ${id} with ${items.length} items`);

    // Get the current order
    const currentOrder = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!currentOrder) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Check if order can be edited (only NEW status)
    if (currentOrder.status !== OrderStatus.NEW) {
      return NextResponse.json(
        { error: "Only new orders can be edited" },
        { status: 400 }
      );
    }

    // Calculate new totals
    const subtotal = items.reduce(
      (sum: number, item: OrderItem) => sum + item.price * item.quantity,
      0
    );
    const tax = subtotal * 0.08; // Assuming 8% tax rate
    const tipAmount = currentOrder.tip || 0;
    const deliveryFee = currentOrder.deliveryFee || 0;
    const total = subtotal + tax + tipAmount + deliveryFee;
    const newAmountInCents = Math.round(total * 100);

    console.log(`Updating order ${id} with new total: $${total.toFixed(2)}`);

    // Update the payment intent with the new amount if needed
    if (currentOrder.paymentIntentId) {
      try {
        // First retrieve the payment intent to check its status
        const paymentIntent = await stripe.paymentIntents.retrieve(
          currentOrder.paymentIntentId
        );

        const currentAmountInCents = paymentIntent.amount;

        if (paymentIntent.status === "requires_capture") {
          if (newAmountInCents <= currentAmountInCents) {
            console.log(
              `New amount ${newAmountInCents} is not greater than current amount ${currentAmountInCents}. No payment update needed.`
            );
            // For decreases or same amount, we don't need to do anything with the payment
            // Just continue with the order update
          } else {
            // For increases, we need to use incrementAuthorization
            console.log(
              `Incrementing authorization from ${currentAmountInCents} to ${newAmountInCents} cents`
            );
            await stripe.paymentIntents.incrementAuthorization(
              currentOrder.paymentIntentId,
              {
                amount: newAmountInCents,
              }
            );
          }
        } else if (
          [
            "requires_payment_method",
            "requires_confirmation",
            "requires_action",
          ].includes(paymentIntent.status)
        ) {
          // For these statuses, we can use the update method
          console.log(
            `Updating payment intent amount to ${newAmountInCents} cents`
          );
          await stripe.paymentIntents.update(currentOrder.paymentIntentId, {
            amount: newAmountInCents,
          });
        } else {
          // For other statuses, just log and continue
          console.log(
            `Payment intent is in status ${paymentIntent.status}, cannot update amount.`
          );
        }
      } catch (stripeError: any) {
        console.error("Stripe payment update failed:", stripeError.message);
        return NextResponse.json(
          { error: `Failed to update payment: ${stripeError.message}` },
          { status: 400 }
        );
      }
    }

    // Delete existing items
    await prisma.orderItem.deleteMany({
      where: { orderId: id },
    });

    // Update the order with new items and totals
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        items: {
          create: items.map((item: OrderItem) => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            notes: item.notes || null,
            // Properly handle modifiers for Prisma JSON field
            modifiers: item.modifiers ? item.modifiers : Prisma.JsonNull,
          })),
        },
        subtotal,
        tax,
        total,
        notes: notes !== undefined ? notes : currentOrder.notes,
        updatedAt: new Date(),
      },
      include: {
        items: true,
      },
    });

    // Update cache
    await updateOrdersCache();

    return NextResponse.json(updatedOrder);
  } catch (error: any) {
    console.error("Failed to edit order:", error);
    return NextResponse.json(
      { error: `Failed to edit order: ${error.message}` },
      { status: 500 }
    );
  }
}
