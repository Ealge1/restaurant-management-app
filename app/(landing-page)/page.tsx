// app/(landing-page)/page.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Percent, Truck, TabletSmartphone, BarChart, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import StaticOrdersPreviewContent from "@/components/static-orders-preview-content";

// Reusable Feature Section Component (Keep as is)
const FeatureSection = ({
  title,
  description,
  points,
  imagePlaceholder,
  reverse = false,
  ctaLink,
  ctaText = "Learn More",
}: {
  title: string;
  description: string;
  points: string[];
  imagePlaceholder: React.ReactNode;
  reverse?: boolean;
  ctaLink?: string;
  ctaText?: string;
}) => (
  <section className="py-16 lg:py-24 bg-white">
    <div className="container mx-auto px-4">
      <div
        className={`grid grid-cols-1 md:grid-cols-2 gap-12 items-center ${
          reverse ? "md:grid-flow-col-dense" : ""
        }`}
      >
        <div className={reverse ? "md:col-start-2" : ""}>
          <h2 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl mb-4">
            {title}
          </h2>
          <p className="text-lg text-gray-600 mb-6">{description}</p>
          <ul className="space-y-3">
            {points.map((point, index) => (
              <li key={index} className="flex items-start">
                <CheckCircle className="h-5 w-5 text-primary mr-3 mt-1 flex-shrink-0" />
                <span className="text-gray-700">{point}</span>
              </li>
            ))}
          </ul>
          {ctaLink && (
             <div className="mt-8">
               <Button variant="outline" asChild>
                 <Link href={ctaLink}>{ctaText}</Link>
               </Button>
             </div>
           )}
        </div>
        <div
          className={`mt-10 md:mt-0 ${reverse ? "md:col-start-1" : ""}`}
        >
          {imagePlaceholder}
        </div>
      </div>
    </div>
  </section>
);

// Placeholder for Image (Keep as is)
const ImagePlaceholder = ({ className = "" }: { className?: string }) => (
  <div
    className={cn(
      "bg-gray-200 aspect-video rounded-lg shadow-md flex items-center justify-center text-gray-500",
      className,
    )}
  >
    Feature Image Placeholder
  </div>
);

export default function LandingPage() {
  return (
    <>
      {/* Hero Section - Updated CTA */}
      <section className="relative bg-gradient-to-b from-white to-gray-50 pt-20 pb-10 md:pt-32 md:pb-20">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            Your Restaurant's Own <span className="text-primary">Commission-Free</span> Ordering & Delivery
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-600 max-w-3xl mx-auto">
            Stop losing profits to third-party apps. Get your own branded online ordering website and manage deliveries without the hefty commission fees with BistroKit.
          </p>
          <div className="mt-10 flex items-center justify-center gap-x-6">
            {/* === UPDATED BUTTON === */}
            <Button size="lg" asChild>
              {/* Link to a demo request page or contact page */}
              <Link href="/store/menu">Try it</Link>
            </Button>
            {/* === END UPDATED BUTTON === */}
            <Button size="lg" variant="outline" asChild>
              <Link href="/store/menu">See How It Works &darr;</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Feature Section 1: Online Ordering Website (Primary Feature) */}
      <div id="features">
        <FeatureSection
          title="Launch Your Commission-Free Ordering Website"
          description="Take back control of your customer relationships and profits. BistroKit provides you with a beautiful, mobile-friendly website where customers can order directly from you – 100% commission-free."
          points={[
            "Keep all the revenue from your direct online orders.",
            "Build your brand with your logo and colors.",
            "Offer a seamless ordering experience on any device.",
            "Easily manage your menu, hours, and settings.",
            "Secure online payments directly to you.",
          ]}
          imagePlaceholder={<ImagePlaceholder />}
          ctaLink="/products/online-ordering"
        />
      </div>

       {/* Feature Section 2: Commission-Free Delivery Management */}
       <FeatureSection
          title="Manage Delivery Without the Marketplace Fees"
          description="Offer delivery on your terms. Integrate with cost-effective third-party fleets like DoorDash Drive or manage your own drivers, all without paying per-order commissions to marketplaces."
          points={[
            "Dispatch orders via DoorDash Drive integration.",
            "Keep customers informed with real-time tracking (via partners).",
            "Set your own delivery zones and fees.",
            "Avoid expensive marketplace commission rates.",
            "Option to manage in-house drivers (coming soon).",
          ]}
          imagePlaceholder={<ImagePlaceholder />}
          reverse={true}
          ctaLink="/products/delivery"
        />

      {/* Interactive Preview Section - Framed as the Control Center */}
      <section className="py-16 lg:py-24 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
              Orders Manager 
            </h2>
            <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
              Manage all your direct orders – from your website, phone-ins, and integrated delivery partners – in one simple, powerful dashboard.
            </p>
          </div>
          <div className="max-w-5xl mx-auto">
            <StaticOrdersPreviewContent />
          </div>
        </div>
      </section>

      {/* Feature Section 3: Unified Order Management (Supporting Feature) */}
      <FeatureSection
          title="All Your Orders, Perfectly Organized"
          description="Even if you still use third-party marketplaces, BistroKit can help. Centralize orders from multiple sources into one streamlined workflow."
          points={[
            "Single dashboard for website, phone, and delivery partner orders.",
            "Reduce errors caused by juggling multiple tablets.",
            "Automated order printing or KDS display.",
            "Improve kitchen efficiency and speed.",
          ]}
          imagePlaceholder={<ImagePlaceholder />}
          ctaLink="/products/order-management"
        />

      {/* Social Proof / Stats - Refocused */}
      <section className="bg-primary text-primary-foreground py-16">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            <div>
              <Percent className="h-10 w-10 mx-auto mb-3" />
              <div className="text-3xl font-bold">No Commission Fees</div>
              <p className="text-sm opacity-90">Avoid unfair commission fees from delivery apps</p>
            </div>
            <div>
              <BarChart className="h-10 w-10 mx-auto mb-3" />
              <div className="text-3xl font-bold">Boost Direct Orders</div>
              <p className="text-sm opacity-90">Own your customer relationships.</p>
            </div>
            <div>
              <TabletSmartphone className="h-10 w-10 mx-auto mb-3" />
              <div className="text-3xl font-bold">Simplify Operations</div>
              <p className="text-sm opacity-90">Manage everything in one place.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA - Updated CTA */}
      <section className="bg-white py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Stop Paying Commissions. Start Growing Your Profit.
          </h2>
          <p className="mt-4 text-lg leading-8 text-gray-600">
            See how BistroKit can transform your restaurant's online presence and profitability.
          </p>
          <div className="mt-10 flex items-center justify-center gap-x-6">
             {/* === UPDATED BUTTON === */}
            <Button size="lg" asChild>
              {/* Link to a demo request page or contact page */}
              <Link href="/contact">Get a Free Demo</Link>
            </Button>
             {/* === END UPDATED BUTTON === */}
             <Button size="lg" variant="outline" asChild>
              <Link href="/pricing">
                 View Pricing Plans
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
