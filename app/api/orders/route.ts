// app/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { updateOrdersCache } from "@/lib/orders-cache";

export async function GET(request: NextRequest) {
  try {
    // Check if we have cached orders
    // If no cache, fetch from database
    const orders = await prisma.order.findMany({
      where: {
        // You may want to add store filtering based on user session
        // storeId: 'current-store-id'
      },
      include: {
        items: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    console.log("orders", orders);
    // Cache the result
    await redis.set("store_orders", JSON.stringify(orders));
    return NextResponse.json(orders);
  } catch (error) {
    // console.error("Failed to fetch orders:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      storeId,
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      items,
      notes,
    } = body;

    // Validate required fields
    if (
      !storeId ||
      !customerName ||
      !customerPhone ||
      !items ||
      items.length === 0
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Calculate order totals
    // TODO: Replace hardcoded 8% tax with Stripe Tax or per-store config (Fix #3)
    const subtotal = items.reduce(
      (sum: number, item: any) => sum + item.price * item.quantity,
      0
    );
    const tax = subtotal * 0.08;
    const total = subtotal + tax;

    // Generate unique order number
    const orderNumber = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

    // Create the order
    const order = await prisma.order.create({
      data: {
        orderNumber,
        status: OrderStatus.NEW,
        items: {
          create: items.map((item: any) => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            notes: item.notes || null,
          })),
        },
        subtotal,
        tax,
        total,
        customerName,
        customerPhone,
        customerEmail: customerEmail || null,
        customerAddress: customerAddress || null,
        notes: notes || null,
        storeId,
      },
      include: {
        items: true,
      },
    });

    // Update Redis cache
    await updateOrdersCache();
    return NextResponse.json(order);
  } catch (error) {
    console.error("Failed to create order:", error);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }
}
