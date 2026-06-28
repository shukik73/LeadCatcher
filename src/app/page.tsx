import Header from '@/components/landing/Header';
import Hero from '@/components/landing/Hero';
import HowItWorks from '@/components/landing/HowItWorks';
import WholeApp from '@/components/landing/WholeApp';
import Testimonial from '@/components/landing/Testimonial';
import Pricing from '@/components/landing/Pricing';
import FinalCta from '@/components/landing/FinalCta';
import Footer from '@/components/landing/Footer';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-[#16120B]">
      <Header />
      <main className="flex-grow">
        <Hero />
        <HowItWorks />
        <WholeApp />
        <Testimonial />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
