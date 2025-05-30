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
  const { cartItems, clearCart } = useCartStore();
  const [clientSecret, setClientSecret] = useState<string>("");
  const [error, setError] = useState<string>("");
  const location = useLocationStore();
  const params = useParams();
  const siteId = params.site_id;
  useEffect(() => {
    if (!cartItems.length) return;

    const createPaymentIntent = async () => {
      try {
        const response = await fetch("/api/create-payment-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cartItems: cartItems.map((item) => ({
              ...item,
              price: item.price,
              modifiers: item.modifiers || [],
            })),
            deliveryType: location.deliveryType,
            deliveryAddress: location.deliveryAddress,
            deliveryApt: location.deliveryApt,
            deliveryInstructions: location.deliveryInstructions,
            recipientFirstName: location.recipientFirstName,
            recipientLastName: location.recipientLastName,
            recipientPhone: location.recipientPhone,
           // Add this if available
            tipAmount: 0, // Set default or get from UI if you have a tip selector
            siteId: siteId,
          }),
        });
    
        if (!response.ok) throw new Error("Payment failed to initialize");
    
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

  const handlePaymentSuccess = () => {
    clearCart(); // Clear the cart after successful payment
  };

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
          <CheckoutForm clientSecret={clientSecret} onSuccess={()=>handlePaymentSuccess} onError={(error)=> alert(error)} />
        </Elements>
      )}
    </div>
  );
}
