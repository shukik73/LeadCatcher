import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata = {
    title: 'Privacy Policy - LeadCatcher',
    description: 'LeadCatcher Privacy Policy - How we handle your data and mobile information.',
};

export default function PrivacyPolicyPage() {
    return (
        <div className="min-h-screen bg-white">
            <div className="container px-4 mx-auto max-w-3xl py-16">
                <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-8"
                >
                    <ArrowLeft size={16} />
                    Back to Home
                </Link>

                <h1 className="text-3xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
                <p className="text-sm text-slate-500 mb-10">
                    Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>

                <div className="prose prose-slate max-w-none space-y-8">
                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-3">Introduction</h2>
                        <p className="text-slate-600 leading-relaxed">
                            LeadCatcher (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is committed to protecting your
                            privacy. This Privacy Policy explains how we collect, use, and safeguard your information
                            when you use our platform and services.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-3">Information We Collect</h2>
                        <p className="text-slate-600 leading-relaxed mb-3">
                            We may collect the following types of information when you use our services:
                        </p>
                        <ul className="list-disc pl-6 text-slate-600 space-y-2">
                            <li>Account information (name, email address, password)</li>
                            <li>Phone numbers and call data associated with missed-call follow-ups</li>
                            <li>Text message content and delivery data</li>
                            <li>Usage data and analytics related to your use of the platform</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-3">SMS Consent and Mobile Information</h2>
                        <p className="text-slate-600 leading-relaxed mb-3">
                            No mobile information will be shared with third parties or affiliates for marketing or
                            promotional purposes. Text messaging originator opt-in data and consent will not be shared,
                            sold, or rented to any third parties.
                        </p>
                        <p className="text-slate-600 leading-relaxed">
                            We may share mobile information only with service providers that help deliver our messaging
                            services (such as messaging platforms and mobile carriers) solely for the purpose of
                            providing those services.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-3">How We Use Your Information</h2>
                        <ul className="list-disc pl-6 text-slate-600 space-y-2">
                            <li>To provide and maintain our missed-call text-back services</li>
                            <li>To send SMS messages related to missed-call follow-ups and customer support</li>
                            <li>To improve and optimize our platform</li>
                            <li>To communicate with you about your account and our services</li>
                            <li>To comply with legal obligations</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-3">Data Sharing</h2>
                        <p className="text-slate-600 leading-relaxed">
                            We do not sell, rent, or share your personal information with third parties for their
                            marketing purposes. We may share information with service providers who assist us in
                            operating our platform, such as messaging platforms and mobile carriers, solely for the
                            purpose of delivering our services.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-3">Data Security</h2>
                        <p className="text-slate-600 leading-relaxed">
                            We implement appropriate technical and organizational measures to protect your personal
                            information against unauthorized access, alteration, disclosure, or destruction.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-3">Your Rights</h2>
                        <p className="text-slate-600 leading-relaxed">
                            You have the right to access, update, or delete your personal information at any time.
                            You may opt out of receiving text messages by replying STOP to any message. For assistance,
                            reply HELP or contact our support team.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-3">Changes to This Policy</h2>
                        <p className="text-slate-600 leading-relaxed">
                            We may update this Privacy Policy from time to time. We will notify you of any changes by
                            posting the new Privacy Policy on this page and updating the &quot;Last updated&quot; date.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-3">Contact Us</h2>
                        <p className="text-slate-600 leading-relaxed">
                            If you have any questions about this Privacy Policy, please contact us at{' '}
                            <a href="mailto:support@leadcatcher.app" className="text-blue-600 hover:underline">
                                support@leadcatcher.app
                            </a>.
                        </p>
                    </section>
                </div>

                <div className="mt-12 pt-8 border-t border-slate-200 text-sm text-slate-500">
                    <p>
                        See also our{' '}
                        <Link href="/terms" className="text-blue-600 hover:underline">
                            Terms and Conditions
                        </Link>.
                    </p>
                </div>
            </div>
        </div>
    );
}
