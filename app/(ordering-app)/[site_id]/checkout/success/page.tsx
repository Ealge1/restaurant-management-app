import { redirect } from "next/navigation";
import { stripe } from "@/lib/stripe";

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string }>;
}) {
  const params = await searchParams;
  const paymentIntentId = params.payment_intent;
  if (!paymentIntentId) redirect("/");

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

  let statusMessage;
  switch (paymentIntent.status) {
    case "succeeded":
      statusMessage = "Payment succeeded! 🎉";
      break;
    case "processing":
      statusMessage = "Payment processing...";
      break;
    case "requires_payment_method":
      statusMessage = "Payment failed. Please try again.";
      break;
    default:
      statusMessage = "Payment status unknown";
  }

  return (
    <div className="max-w-2xl mx-auto p-4 text-center">
      <h1 className="text-2xl font-bold mb-4">{statusMessage}</h1>
      <p className="mb-4">Payment ID: {paymentIntent.id}</p>
      <a
        href="/"
        className="text-blue-600 hover:underline"
      >
        Return to store
      </a>
    </div>
  );
}
