"use client";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useState } from "react";
import { useCartStore } from "@/stores/cartStore";
import { useLocationStore } from "@/stores/useLocationStore";
import CheckoutForm from "@/components/CheckoutForm";
import { useParams } from "next/navigation";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

export default function CheckoutPage() {
  const { cartItems } = useCartStore();
  const [clientSecret, setClientSecret] = useState<string>("");
  const [error, setError] = useState<string>("");
  const location = useLocationStore();
  const params = useParams();
  const siteId = params.site_id;

  useEffect(() => {
    if (!cartItems.length) return;

    const createPaymentIntent = async () => {
      try {
        // Send ONLY ids, quantities, and selected modifier ids.
        // No prices — the server looks those up from the database.
        const safeCartItems = cartItems.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          modifierIds: (item.modifiers ?? []).flatMap((m) =>
            // Each selected modifier may have a quantity > 1 (e.g. 2 extra cheese).
            // Repeat its id so the server counts its price that many times.
            Array.from({ length: m.quantity ?? 1 }, () => m.id)
          ),
          notes: (item as any).notes ?? "",
        }));

        const response = await fetch("/api/create-payment-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cartItems: safeCartItems,
            deliveryType: location.deliveryType,
            deliveryAddress: location.deliveryAddress,
            deliveryApt: location.deliveryApt,
            deliveryInstructions: location.deliveryInstructions,
            recipientFirstName: location.recipientFirstName,
            recipientLastName: location.recipientLastName,
            recipientPhone: location.recipientPhone,
            tipAmount: 0, // TODO: wire up Tips.tsx selector
            siteId: siteId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error || "Payment failed to initialize"
          );
        }

        const { clientSecret } = await response.json();
        setClientSecret(clientSecret);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to initialize payment"
        );
      }
    };

    createPaymentIntent();
  }, [cartItems]);

  return (
    <div className="max-w-2xl mx-auto p-4">
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 p-4 mb-4 rounded">
          {error}
        </div>
      )}

      {clientSecret && stripePromise && (
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: {
              theme: "stripe",
              variables: { colorPrimary: "#0055de" },
            },
          }}
        >
          <CheckoutForm
            clientSecret={clientSecret}
            onSuccess={() => null}
            onError={(error) => alert(error)}
          />
        </Elements>
      )}
    </div>
  );
}
