// app/api/create-checkout-session/route.ts
import { stripe } from "@/lib/stripe";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import { getUberAuthToken, getUberDeliveryQuotes } from "@/lib/uber";
import { redis } from "@/lib/redis";
import { parseDeliveryAddress } from "@/lib/address";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      lineItems,
      deliveryType,
      selectedLocation,
      scheduledTime,
      scheduledDate,
      deliveryAddress,
      deliveryApt,
      deliveryInstructions,
      recipientFirstName,
      recipientLastName,
      recipientPhone,
      dropoff_address,
    } = body;

    // 1. Create Delivery Quote ONLY if delivery type is "delivery"
    let deliveryQuote = null;
    if (deliveryType === "delivery") {
      try {
        // Generate a unique ID for this delivery
        const externalDeliveryId = uuidv4();

        // Hardcoded pickup address
        const pickupAddress = {
          street_address: ["376 Jefferson Rd", ""],
          state: "NY",
          city: "Rochester",
          zip_code: "14623",
          country: "US",
        };

        // Parse the delivery address string into the required format
        const dropoffAddress = parseDeliveryAddress(deliveryAddress, deliveryApt);

        console.log("dropoff_address", deliveryAddress);
        console.log("delivery type", deliveryType);
        console.log("formatted dropoff address", dropoffAddress);

        const auth = await getUberAuthToken();
        const uberQuote = await getUberDeliveryQuotes({
          authToken: auth?.access_token,
          pickupAddress: pickupAddress,
          dropoffAddress: dropoffAddress,
        });

        deliveryQuote = uberQuote;
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

    // 2. Prepare Line Items for Stripe
    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    // Add cart items including modifiers
    for (const item of lineItems) {
      // Main product item
      if (item.price) {
        line_items.push({
          price: item.price,
          quantity: item.quantity,
        });
      } else {
        line_items.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: item.name,
              description: item.description || undefined,
            },
            unit_amount: Math.round(item.price * 100), // Convert to cents
          },
          quantity: item.quantity,
        });
      }

      // Add modifiers if any
      if (item.modifiers && item.modifiers.length > 0) {
        for (const modifier of item.modifiers) {
          if (modifier.stripePriceId) {
            // Use existing Stripe price for modifiers
            line_items.push({
              price: modifier.stripePriceId,
              quantity: item.quantity, // important to multiply by main item quantity
            });
          } else {
            // Create price on-the-fly for modifiers
            line_items.push({
              price_data: {
                currency: "usd",
                product_data: {
                  name: `${item.name} - ${modifier.name}`, // naming them clearly
                  description: modifier.description || undefined,
                },
                unit_amount: Math.round(modifier.price * 100), // Convert to cents
              },
              quantity: item.quantity, // multiply by main item quantity
            });
          }
        }
      }
    }

    // 3. Add delivery fee ONLY if deliveryType is delivery and we have a valid quote
    if (
      deliveryType === "delivery" &&
      deliveryQuote &&
      typeof deliveryQuote.fee === "number"
    ) {
      const feeValue = Number(deliveryQuote.fee);
      if (!isNaN(feeValue) && Number.isInteger(feeValue) && feeValue > 0) {
        console.log("Adding delivery fee:", feeValue);
        line_items.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: "Delivery Fee",
              description: "Delivery service fee",
            },
            unit_amount: feeValue,
          },
          quantity: 1,
        });
      } else {
        console.warn(
          "Invalid delivery fee amount:",
          deliveryQuote.fee,
          "Type:",
          typeof deliveryQuote.fee
        );
      }
    } else if (deliveryType === "delivery") {
      console.warn(
        "Delivery quote or fee is missing or not a number, Type:",
        typeof deliveryQuote?.fee
      );
    }

    // Check if we have valid line items
    if (line_items.length === 0) {
      throw new Error("No valid line items provided");
    }

    // Debugging - log the line items to see what's being sent to Stripe
    console.log("Sending to Stripe:", JSON.stringify(line_items, null, 2));

    // 4. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      line_items: line_items,
      mode: "payment",
      automatic_tax: { enabled: true },
      return_url: "http://dumebi.localhost:3000",
      metadata: {
        deliveryType: deliveryType || "pickup",
        selectedLocation: selectedLocation
          ? JSON.stringify(selectedLocation)
          : null,
        scheduledTime: scheduledTime || null,
        scheduledDate: scheduledDate || null,
        deliveryAddress: deliveryAddress || null,
        deliveryApt: deliveryApt || null,
        deliveryInstructions: deliveryInstructions || null,
        recipientFirstName: recipientFirstName || null,
        recipientLastName: recipientLastName || null,
        recipientPhone: recipientPhone || null,
        deliveryQuoteId: deliveryQuote?.id || null,
        deliveryFee: deliveryQuote?.fee
          ? (deliveryQuote.fee / 100).toFixed(2)
          : null,
      },
    });
    console.log("Created Checkout Session:", session);

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (error: any) {
    console.error("Stripe error:", error);
    return NextResponse.json(
      { error: `Failed to create checkout session: ${error}` },
      { status: 500 }
    );
  }
}
