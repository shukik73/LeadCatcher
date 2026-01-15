"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';
import { toast } from 'sonner';
import { CheckCircle2, Phone, Loader2, Copy, AlertCircle } from 'lucide-react';
import { verifyTwilioPhoneNumber, linkTwilioNumberToBusiness } from '@/app/actions/twilio';

// Validation Schemas
const businessSchema = z.object({
    businessName: z.string().min(2, "Business name is required"),
    businessPhone: z.string().min(10, "Valid phone number required").regex(/^\+?1?\d{10,14}$/, "Invalid phone format"),
    ownerPhone: z.string().min(10, "Valid mobile number required").regex(/^\+?1?\d{10,14}$/, "Invalid phone format"),
});

const carrierSchema = z.object({
    carrier: z.string().min(1, "Please select a carrier"),
});

const twilioNumberSchema = z.object({
    twilioNumber: z.string()
        .min(10, "Phone number is too short")
        .regex(/^\+?1?\d{10,14}$/, "Invalid phone format. Use: +15551234567"),
});

type BusinessFormData = z.infer<typeof businessSchema>;
type CarrierFormData = z.infer<typeof carrierSchema>;
type TwilioNumberFormData = z.infer<typeof twilioNumberSchema>;

export default function Wizard() {
    const [step, setStep] = useState(1);
    const [forwardingNumber, setForwardingNumber] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [isVerified, setIsVerified] = useState(false);
    const [twilioVerified, setTwilioVerified] = useState(false);
    const [verificationError, setVerificationError] = useState<string | null>(null);
    const router = useRouter();
    const supabase = createSupabaseBrowserClient();

    // Forms
    const businessForm = useForm<BusinessFormData>({
        resolver: zodResolver(businessSchema),
        defaultValues: { businessName: '', businessPhone: '', ownerPhone: '' }
    });

    const carrierForm = useForm<CarrierFormData>({
        resolver: zodResolver(carrierSchema),
        defaultValues: { carrier: '' }
    });

    const twilioForm = useForm<TwilioNumberFormData>({
        resolver: zodResolver(twilioNumberSchema),
        defaultValues: { twilioNumber: '' }
    });

    // Derived state
    const carrier = carrierForm.watch('carrier');

    // Handlers
    const onBusinessSubmit = async (data: BusinessFormData) => {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            toast.error("You must be logged in");
            return;
        }

        // Create business without forwarding number (will be added in Step 3)
        const { error } = await supabase.from('businesses').upsert({
            user_id: user.id,
            name: data.businessName,
            business_phone: data.businessPhone,
            owner_phone: data.ownerPhone,
            carrier: 'Pending'
        }, { onConflict: 'user_id' }).select().single();

        if (error) {
            console.error(error);
            toast.error("Failed to save business");
            return;
        }

        setStep(2);
    };

    const onCarrierSubmit = async (data: CarrierFormData) => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            await supabase.from('businesses').update({ carrier: data.carrier }).eq('user_id', user.id);
        }
        setStep(3);
    };

    const onTwilioNumberSubmit = async (data: TwilioNumberFormData) => {
        setIsVerifying(true);
        setVerificationError(null);

        try {
            // Verify the number exists in their Twilio account
            const result = await verifyTwilioPhoneNumber(data.twilioNumber);

            if (!result.success) {
                setVerificationError(result.error);
                setIsVerifying(false);
                return;
            }

            // Link the verified number to their business
            const linkResult = await linkTwilioNumberToBusiness(
                result.phoneNumber,
                result.sid
            );

            if (!linkResult.success) {
                setVerificationError(linkResult.error || 'Failed to save number');
                setIsVerifying(false);
                return;
            }

            // Success!
            setForwardingNumber(result.phoneNumber);
            setTwilioVerified(true);
            toast.success('Twilio number verified and linked!');

            // Move to next step after brief delay
            setTimeout(() => {
                setIsVerifying(false);
                setStep(4);
            }, 1500);

        } catch (error) {
            console.error('Verification error:', error);
            setVerificationError('An unexpected error occurred. Please try again.');
            setIsVerifying(false);
        }
    };

    const handleCopyCode = () => {
        const code = carrier === 'Verizon' ? '*71' : '*72';
        navigator.clipboard.writeText(`${code}${forwardingNumber.replace(/\D/g, '')}`);
        toast.success('Forwarding code copied!');
    };

    const runTestCall = async () => {
        setIsVerifying(true);
        try {
            const res = await fetch('/api/verify', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setTimeout(() => {
                    setIsVerified(true);
                    setIsVerifying(false);
                }, 3000);
            }
        } catch (e) {
            console.error(e);
            setIsVerifying(false);
        }
    };

    // Format phone number for display
    const formatPhoneDisplay = (phone: string) => {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 11 && cleaned.startsWith('1')) {
            return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
        }
        return phone;
    };

    return (
        <div className="max-w-xl mx-auto">
            {/* Progress Bar */}
            <div className="mb-8 flex justify-between relative" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={5} aria-label={`Onboarding progress: step ${step} of 5`}>
                <div className="absolute top-1/2 left-0 w-full h-1 bg-slate-100 -z-10 rounded-full"></div>
                <div className={`absolute top-1/2 left-0 h-1 bg-blue-600 -z-10 rounded-full transition-all duration-500`} style={{ width: `${((step - 1) / 4) * 100}%` }}></div>
                {[1, 2, 3, 4, 5].map((s) => (
                    <div key={s} className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${step >= s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {s}
                    </div>
                ))}
            </div>

            <AnimatePresence mode="wait">

                {/* STEP 1: Business Info */}
                {step === 1 && (
                    <motion.div
                        key="step1"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                    >
                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle>Tell us about your business</CardTitle>
                                <CardDescription>We need this to route your calls and send notifications.</CardDescription>
                            </CardHeader>
                            <form onSubmit={businessForm.handleSubmit(onBusinessSubmit)}>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="businessName">Business Name</Label>
                                        <Input id="businessName" placeholder="Techy Miramar" {...businessForm.register('businessName')} />
                                        {businessForm.formState.errors.businessName && <p className="text-xs text-red-500">{businessForm.formState.errors.businessName.message}</p>}
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="businessPhone">Business Phone Number</Label>
                                        <Input id="businessPhone" placeholder="(305) 555-0123" {...businessForm.register('businessPhone')} />
                                        {businessForm.formState.errors.businessPhone && <p className="text-xs text-red-500">{businessForm.formState.errors.businessPhone.message}</p>}
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="ownerPhone">Owner Mobile Number</Label>
                                        <Input id="ownerPhone" placeholder="(786) 555-9876" {...businessForm.register('ownerPhone')} />
                                        <p className="text-xs text-slate-500">We will text this number when you miss a call.</p>
                                        {businessForm.formState.errors.ownerPhone && <p className="text-xs text-red-500">{businessForm.formState.errors.ownerPhone.message}</p>}
                                    </div>
                                </CardContent>
                                <CardFooter>
                                    <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700">Continue</Button>
                                </CardFooter>
                            </form>
                        </Card>
                    </motion.div>
                )}

                {/* STEP 2: Carrier */}
                {step === 2 && (
                    <motion.div
                        key="step2"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                    >
                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle>Select your carrier</CardTitle>
                                <CardDescription>Different carriers have different activation codes.</CardDescription>
                            </CardHeader>
                            <form onSubmit={carrierForm.handleSubmit(onCarrierSubmit)}>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="carrier">Service Provider</Label>
                                        <Select onValueChange={(val) => carrierForm.setValue('carrier', val)}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select carrier" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Verizon">Verizon</SelectItem>
                                                <SelectItem value="AT&T">AT&T</SelectItem>
                                                <SelectItem value="T-Mobile">T-Mobile</SelectItem>
                                                <SelectItem value="Other">Other</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {carrierForm.formState.errors.carrier && <p className="text-xs text-red-500">{carrierForm.formState.errors.carrier.message}</p>}
                                    </div>
                                </CardContent>
                                <CardFooter className="flex gap-2">
                                    <Button variant="outline" className="w-full" onClick={() => setStep(1)}>Back</Button>
                                    <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700">Continue</Button>
                                </CardFooter>
                            </form>
                        </Card>
                    </motion.div>
                )}

                {/* STEP 3: Link Twilio Number */}
                {step === 3 && (
                    <motion.div
                        key="step3"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                    >
                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle>Link Your Twilio Number</CardTitle>
                                <CardDescription>
                                    Enter the Twilio phone number you purchased. We will verify it belongs to your account.
                                </CardDescription>
                            </CardHeader>
                            <form onSubmit={twilioForm.handleSubmit(onTwilioNumberSubmit)}>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="twilioNumber">Twilio Phone Number</Label>
                                        <Input
                                            id="twilioNumber"
                                            placeholder="+15551234567"
                                            {...twilioForm.register('twilioNumber')}
                                            disabled={isVerifying || twilioVerified}
                                        />
                                        <p className="text-xs text-slate-500">
                                            Use E.164 format (e.g., +15551234567). Find this in your Twilio Console.
                                        </p>
                                        {twilioForm.formState.errors.twilioNumber && (
                                            <p className="text-xs text-red-500">{twilioForm.formState.errors.twilioNumber.message}</p>
                                        )}
                                    </div>

                                    {/* Verification Error */}
                                    {verificationError && (
                                        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                                            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                                            <div>
                                                <p className="text-sm text-red-800 font-medium">Verification Failed</p>
                                                <p className="text-sm text-red-600 mt-1">{verificationError}</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Verification Success */}
                                    {twilioVerified && (
                                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                                            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                                            <div>
                                                <p className="text-sm text-green-800 font-medium">Number Verified!</p>
                                                <p className="text-sm text-green-600 mt-1">
                                                    {formatPhoneDisplay(forwardingNumber)} is now linked to your account.
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Help Box */}
                                    <div className="bg-blue-50 p-4 rounded-lg">
                                        <h4 className="font-semibold text-blue-900 text-sm mb-2">Where to find your Twilio number:</h4>
                                        <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
                                            <li>Log in to your Twilio Console</li>
                                            <li>Go to Phone Numbers → Manage → Active Numbers</li>
                                            <li>Copy the number in E.164 format (+1...)</li>
                                        </ol>
                                    </div>
                                </CardContent>
                                <CardFooter className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        className="w-full"
                                        onClick={() => setStep(2)}
                                        disabled={isVerifying}
                                    >
                                        Back
                                    </Button>
                                    <Button
                                        type="submit"
                                        className="w-full bg-blue-600 hover:bg-blue-700"
                                        disabled={isVerifying || twilioVerified}
                                    >
                                        {isVerifying ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Verifying...
                                            </>
                                        ) : twilioVerified ? (
                                            <>
                                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                                Verified
                                            </>
                                        ) : (
                                            'Verify & Link Number'
                                        )}
                                    </Button>
                                </CardFooter>
                            </form>
                        </Card>
                    </motion.div>
                )}

                {/* STEP 4: Setup Instructions */}
                {step === 4 && (
                    <motion.div
                        key="step4"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                    >
                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle>Activate Call Forwarding</CardTitle>
                                <CardDescription>Dial this code on your business phone to forward missed calls to LeadCatcher.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="bg-slate-50 p-6 rounded-xl border border-dashed border-slate-300 text-center">
                                    <p className="text-sm text-slate-500 mb-2">Dial this exactly:</p>
                                    <div className="text-3xl font-mono font-bold text-slate-900 tracking-wider flex items-center justify-center gap-3">
                                        {carrier === 'Verizon' ? '*71' : '*72'} {formatPhoneDisplay(forwardingNumber)}
                                        <Button variant="ghost" size="icon" onClick={handleCopyCode}><Copy size={16} /></Button>
                                    </div>
                                </div>
                                <div className="bg-blue-50 p-4 rounded-lg flex items-start gap-3">
                                    <div className="bg-blue-100 p-2 rounded-full text-blue-600">
                                        <Phone size={16} />
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-blue-900 text-sm">Conditional Forwarding</h4>
                                        <p className="text-xs text-blue-700 mt-1">
                                            This code ({carrier === 'Verizon' ? '*71' : '*72'}) only forwards calls when you do not answer or are busy. Your phone still rings!
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="flex gap-2">
                                <Button variant="outline" className="w-full" onClick={() => setStep(3)}>Back</Button>
                                <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => setStep(5)}>I have dialed the code</Button>
                            </CardFooter>
                        </Card>
                    </motion.div>
                )}

                {/* STEP 5: Verify */}
                {step === 5 && (
                    <motion.div
                        key="step5"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                    >
                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle>Testing Connection...</CardTitle>
                                <CardDescription>We will give your business line a call to make sure forwarding works.</CardDescription>
                            </CardHeader>
                            <CardContent className="py-10 text-center">
                                {isVerified ? (
                                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex flex-col items-center">
                                        <div className="h-20 w-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-4">
                                            <CheckCircle2 size={40} />
                                        </div>
                                        <h3 className="text-xl font-bold text-slate-900">It Works!</h3>
                                        <p className="text-slate-500 mt-2">Your missed calls are now being caught.</p>
                                    </motion.div>
                                ) : (
                                    <div className="flex flex-col items-center">
                                        <div className={`h-20 w-20 rounded-full flex items-center justify-center mb-4 transition-colors ${isVerifying ? 'bg-blue-50 text-blue-600 animate-pulse' : 'bg-slate-100 text-slate-400'}`}>
                                            <Phone size={40} className={isVerifying ? 'animate-bounce' : ''} />
                                        </div>
                                        {isVerifying && <p className="text-slate-600 font-medium">Calling {businessForm.getValues('businessPhone')}...</p>}
                                        {!isVerifying && <p className="text-slate-500">Ready to test?</p>}
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="flex gap-2">
                                {!isVerified ? (
                                    <>
                                        <Button variant="outline" className="w-full" onClick={() => setStep(4)} disabled={isVerifying}>Back</Button>
                                        <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={runTestCall} disabled={isVerifying}>
                                            {isVerifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Run Test Call'}
                                        </Button>
                                    </>
                                ) : (
                                    <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => router.push('/dashboard')}>Go to Dashboard</Button>
                                )}
                            </CardFooter>
                        </Card>
                    </motion.div>
                )}

            </AnimatePresence>
        </div>
    );
}
