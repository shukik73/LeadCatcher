import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata = {
    title: 'Terms and Conditions - LeadCatcher',
    description: 'LeadCatcher Terms and Conditions - SMS messaging terms and service agreement.',
};

export default function TermsAndConditionsPage() {
    return (
        <div className="min-h-screen bg-card">
            <div className="container px-4 mx-auto max-w-3xl py-16">
                <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8"
                >
                    <ArrowLeft size={16} />
                    Back to Home
                </Link>

                <h1 className="text-3xl font-bold text-foreground mb-2">Terms and Conditions</h1>
                <p className="text-sm text-muted-foreground mb-10">
                    Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>

                <div className="prose prose-slate max-w-none space-y-8">
                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">Introduction</h2>
                        <p className="text-muted-foreground leading-relaxed">
                            These Terms and Conditions (&quot;Terms&quot;) govern your use of the LeadCatcher platform
                            and services. By accessing or using our services, you agree to be bound by these Terms.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">SMS Messaging Terms</h2>
                        <p className="text-muted-foreground leading-relaxed mb-3">
                            By providing your phone number and calling a business using the LeadCatcher platform,
                            you consent to receive text messages related to missed-call follow-ups and customer support.
                        </p>
                        <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                            <li>Message frequency varies.</li>
                            <li>Message and data rates may apply.</li>
                            <li>You may opt out at any time by replying <strong>STOP</strong>.</li>
                            <li>
                                For help, reply <strong>HELP</strong> or contact support at{' '}
                                <a href="mailto:support@leadcatcher.app" className="text-primary hover:underline">
                                    support@leadcatcher.app
                                </a>.
                            </li>
                            <li>Carriers are not liable for delayed or undelivered messages.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">SMS Consent and Mobile Information</h2>
                        <p className="text-muted-foreground leading-relaxed mb-3">
                            No mobile information will be shared with third parties or affiliates for marketing or
                            promotional purposes. Text messaging originator opt-in data and consent will not be shared,
                            sold, or rented to any third parties.
                        </p>
                        <p className="text-muted-foreground leading-relaxed">
                            We may share mobile information only with service providers that help deliver our messaging
                            services (such as messaging platforms and mobile carriers) solely for the purpose of
                            providing those services.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">Use of Services</h2>
                        <p className="text-muted-foreground leading-relaxed">
                            You agree to use LeadCatcher only for lawful purposes and in accordance with these Terms.
                            You are responsible for maintaining the confidentiality of your account credentials and for
                            all activities that occur under your account.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">Service Availability</h2>
                        <p className="text-muted-foreground leading-relaxed">
                            We strive to keep LeadCatcher available at all times, but we do not guarantee uninterrupted
                            access. We may modify, suspend, or discontinue any part of our services at any time without
                            prior notice.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">Limitation of Liability</h2>
                        <p className="text-muted-foreground leading-relaxed">
                            To the fullest extent permitted by law, LeadCatcher shall not be liable for any indirect,
                            incidental, special, consequential, or punitive damages arising from your use of our
                            services, including but not limited to missed messages, delayed notifications, or service
                            interruptions.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">Changes to These Terms</h2>
                        <p className="text-muted-foreground leading-relaxed">
                            We reserve the right to modify these Terms at any time. Changes will be effective
                            immediately upon posting to this page. Your continued use of our services after any
                            changes constitutes acceptance of the updated Terms.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-foreground mb-3">Contact Us</h2>
                        <p className="text-muted-foreground leading-relaxed">
                            If you have any questions about these Terms, please contact us at{' '}
                            <a href="mailto:support@leadcatcher.app" className="text-primary hover:underline">
                                support@leadcatcher.app
                            </a>.
                        </p>
                    </section>
                </div>

                <div className="mt-12 pt-8 border-t border-border text-sm text-muted-foreground">
                    <p>
                        For more information on how we handle your data, please review our{' '}
                        <Link href="/privacy" className="text-primary hover:underline">
                            Privacy Policy
                        </Link>.
                    </p>
                </div>
            </div>
        </div>
    );
}
