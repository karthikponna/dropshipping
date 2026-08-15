import { ClosingCta } from "@/components/marketing/closing-cta";
import { Features } from "@/components/marketing/features";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { PageTypeSplit } from "@/components/marketing/page-type-split";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

export default function MarketingHomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero />
        <HowItWorks />
        <PageTypeSplit />
        <Features />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}
