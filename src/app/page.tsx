import Header from '@/components/landing/Header';
import Hero from '@/components/landing/Hero';
import Pricing from '@/components/landing/Pricing';
import Footer from '@/components/landing/Footer';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header />
      <main className="flex-grow">
        <Hero />
        <Pricing />
        {/* Placeholder for FAQ or HowItWorks if needed later */}
      </main>
      <Footer />
    </div>
  );
}
