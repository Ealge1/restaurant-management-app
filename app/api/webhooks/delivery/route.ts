// /api/webhooks/delivery/route
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { DeliveryStatus, Prisma } from "@prisma/client";
import * as crypto from "crypto";

// Your Uber Direct webhook signing key
// TODO (security): move to process.env.UBER_WEBHOOK_SECRET — this should NOT be hardcoded
const WEBHOOK_SECRET =
  process.env.UBER_WEBHOOK_SECRET ||
  "3b947192-f4e3-4779-8935-0eccfd892a4d";

export async function POST(req: NextRequest) {
  // First, get the raw request body for signature verification
  const rawBody = await req.text();
  
  try {
    // Get the signature from headers
    const signature = req.headers.get("x-uber-signature") || 
                      req.headers.get("x-postmates-signature");
    
    // Verify webhook signature
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.error("Invalid webhook signature");
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // Parse the body as JSON after verification
    const data = JSON.parse(rawBody);
    console.log("Uber Direct Webhook Received:", data.kind);

    // Extract the delivery ID from the webhook data
    const deliveryId = data.delivery_id;

    if (!deliveryId) {
      return NextResponse.json(
        { error: "Delivery ID not found in webhook data" },
        { status: 400 }
      );
    }

    // Find the order by delivery ID
    const existingOrder = await prisma.order.findFirst({
      where: { deliveryId: deliveryId },
    });

    if (!existingOrder) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Process the webhook based on the event type
    switch (data.kind) {
      case "event.delivery_status":
        await handleDeliveryStatusWebhook(existingOrder.id, data);
        break;
      case "event.courier_update":
        await handleCourierUpdateWebhook(existingOrder.id, data);
        break;
      case "event.refund_request":
        await handleRefundWebhook(existingOrder.id, data);
        break;
      default:
        console.warn("Unknown webhook type received:", data.kind);
        return NextResponse.json(
          { message: "Unhandled webhook type", kind: data.kind },
          { status: 200 } // Return 200 to acknowledge receipt even if we don't process it
        );
    }

    // Update Redis store after any webhook processing
    const orders = await prisma.order.findMany({
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
    await redis.set("store_orders", JSON.stringify(orders));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`Uber Direct webhook error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Function to verify webhook signature
function verifyWebhookSignature(payload: string, signature?: string | null): boolean {
  if (!signature) {
    console.error("No signature provided in webhook");
    return false;
  }

  try {
    // Create the HMAC-SHA256 hash using the webhook secret
    const computedSignature = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(payload, "utf8")
      .digest("hex");
    
    // Compare the signatures - using a constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch (error) {
    console.error("Error verifying webhook signature:", error);
    return false;
  }
}

// Handler for delivery status webhooks
async function handleDeliveryStatusWebhook(orderId: string, data: any) {
  console.log("Processing delivery status webhook");

  // Map Uber Direct status to our DeliveryStatus enum
  const statusMap: { [key: string]: DeliveryStatus } = {
    created: "PENDING",
    accepted: "COURIER_ASSIGNED",
    picked_up: "PICKED_UP",
    delivered: "DELIVERED",
    canceled: "FAILED",
    returned: "FAILED",
  };

  const uberStatus = data.status;
  const deliveryStatus = statusMap[uberStatus] || "PENDING";

  const estimatedDropoffTime = data.data.dropoff_eta
    ? new Date(data.data.dropoff_eta)
    : null;

  // Update the order with delivery status data
  await prisma.order.update({
    where: { id: orderId },
    data: {
      deliveryStatus: deliveryStatus,
      uberStatus: uberStatus,
      uberTrackingUrl: data.data.tracking_url,
      deliveryFee: data.data.fee ? data.data.fee / 100 : null,
      dasherName: data.data.courier?.name,
      dasherPhone: data.data.courier?.public_phone_info?.phone_number,
      estimatedPickupTime: data.data.pickup_eta
        ? new Date(data.data.pickup_eta)
        : null,
      estimatedDropoffTime: estimatedDropoffTime,
      lastUpdated: new Date(),
    },
  });
}

// Handler for courier update webhooks
async function handleCourierUpdateWebhook(orderId: string, data: any) {
  console.log("Processing courier update webhook");

  const courierData = data.data.courier;
  
  // Update the order with courier information
  await prisma.order.update({
    where: { id: orderId },
    data: {
      dasherName: courierData?.name,
      dasherPhone: courierData?.public_phone_info?.phone_number,
      courierLocationLat: courierData?.location?.lat || null,
      courierLocationLng: courierData?.location?.lng || null,
      courierVehicleType: courierData?.vehicle_type || null,
      courierVehicleMake: courierData?.vehicle_make || null,
      courierVehicleModel: courierData?.vehicle_model || null,
      courierVehicleColor: courierData?.vehicle_color || null,
      courierRating: courierData?.rating || null,
      lastUpdated: new Date(),
    },
  });
}

// Handler for refund webhooks
async function handleRefundWebhook(orderId: string, data: any) {
  console.log("Processing refund request webhook");

  const refundData = data.data;
  
  // Calculate total refund amount
  const totalRefundAmount = (refundData.total_partner_refund + refundData.total_uber_refund) / 100;
  
  // Extract refund item details if available
  const refundItems = refundData.refund_order_items?.map((item: any) => ({
    reason: item.reason,
    partyAtFault: item.party_at_fault,
    items: item.refund_items,
    partnerRefundAmount: item.partner_refund_amount / 100,
    uberRefundAmount: item.uber_refund_amount / 100
  }));
  
  // Update the order with refund information
  await prisma.order.update({
    where: { id: orderId },
    data: {
      refundAmount: totalRefundAmount,
      refundReason: refundItems?.[0]?.reason || null,
      refundPartyAtFault: refundItems?.[0]?.partyAtFault || null,
      refundItems: refundItems ? JSON.stringify(refundItems) : Prisma.JsonNull,
      refundFees: refundData.refund_fees ? JSON.stringify(refundData.refund_fees) : Prisma.JsonNull,
      refundedAt: refundData.created_at ? new Date(refundData.created_at) : new Date(),
      lastUpdated: new Date(),
    },
  });
}
