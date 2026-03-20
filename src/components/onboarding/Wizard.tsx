"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
import { CheckCircle2, Phone, Loader2, Copy, AlertCircle } from 'lucide-react';
import { autoLinkTwilioNumber } from '@/app/actions/twilio';

// Strip non-digit characters (except leading +) for phone validation
function normalizePhone(value: string): string {
    const hasPlus = value.startsWith('+');
    const digits = value.replace(/\D/g, '');
    return hasPlus ? `+${digits}` : digits;
}

// Validation Schema
const businessSchema = z.object({
    businessName: z.string().min(2, "Business name is required"),
    businessPhone: z.string().transform(normalizePhone).pipe(
        z.string().min(10, "Valid phone number required").regex(/^\+?1?\d{10,14}$/, "Invalid phone format")
    ),
    ownerPhone: z.string().transform(normalizePhone).pipe(
        z.string().min(10, "Valid mobile number required").regex(/^\+?1?\d{10,14}$/, "Invalid phone format")
    ),
    carrier: z.string().min(1, "Please select a carrier"),
});

type BusinessFormData = z.infer<typeof businessSchema>;

export default function Wizard() {
    const [step, setStep] = useState(1);
    const [forwardingNumber, setForwardingNumber] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [isVerified, setIsVerified] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [verificationError, setVerificationError] = useState<string | null>(null);
    const router = useRouter();
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    const businessForm = useForm<BusinessFormData>({
        resolver: zodResolver(businessSchema),
        defaultValues: { businessName: '', businessPhone: '', ownerPhone: '', carrier: '' }
    });

    const carrier = useWatch({ control: businessForm.control, name: 'carrier' });

    // Step 1 → Save business info + auto-connect Twilio → Step 2
    const onBusinessSubmit = async (data: BusinessFormData) => {
        setIsConnecting(true);
        setVerificationError(null);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            toast.error("You must be logged in");
            setIsConnecting(false);
            return;
        }

        // Save business info
        const { error } = await supabase.from('businesses').upsert({
            user_id: user.id,
            name: data.businessName,
            business_phone: data.businessPhone,
            owner_phone: data.ownerPhone,
            carrier: data.carrier,
        }, { onConflict: 'user_id' }).select().single();

        if (error) {
            logger.error('Failed to save business', error);
            toast.error("Failed to save business");
            setIsConnecting(false);
            return;
        }

        // Auto-connect Twilio number
        try {
            const result = await autoLinkTwilioNumber();

            if (!result.success) {
                setVerificationError(result.error || 'Failed to connect phone number');
                setIsConnecting(false);
                return;
            }

            setForwardingNumber(result.forwardingNumber || '');
            toast.success('Phone number connected!');
            setIsConnecting(false);
            setStep(2);
        } catch (err) {
            logger.error('Connection error', err);
            setVerificationError('An unexpected error occurred. Please try again.');
            setIsConnecting(false);
        }
    };

    const handleCopyCode = () => {
        const code = carrier === 'Verizon' ? '*71' : '*72';
        navigator.clipboard.writeText(`${code}${forwardingNumber.replace(/\D/g, '')}`);
        toast.success('Forwarding code copied!');
    };

    // Poll verification status from DB
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollCountRef = useRef(0);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        pollCountRef.current = 0;
    }, []);

    useEffect(() => {
        return () => stopPolling();
    }, [stopPolling]);

    const runTestCall = async () => {
        setIsVerifying(true);
        setVerificationError(null);
        try {
            const res = await fetch('/api/verify', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                pollCountRef.current = 0;
                pollRef.current = setInterval(async () => {
                    pollCountRef.current++;
                    try {
                        const pollRes = await fetch('/api/verify');
                        const pollData = await pollRes.json();
                        if (pollData.verified) {
                            setIsVerified(true);
                            setIsVerifying(false);
                            stopPolling();
                        } else if (pollCountRef.current >= 15) {
                            setIsVerifying(false);
                            setVerificationError('Verification timed out. Make sure you declined/ignored the call so it forwarded to your Twilio number, then try again.');
                            stopPolling();
                        }
                    } catch {
                        // Ignore individual poll failures
                    }
                }, 2000);
            } else {
                setVerificationError(data.error || 'Failed to initiate test call');
                setIsVerifying(false);
            }
        } catch (e) {
            logger.error('Test call failed', e);
            setVerificationError('Failed to connect to server. Please try again.');
            setIsVerifying(false);
        }
    };

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
            <div className="mb-8 flex justify-between relative" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={3} aria-label={`Onboarding progress: step ${step} of 3`}>
                <div className="absolute top-1/2 left-0 w-full h-1 bg-slate-100 -z-10 rounded-full"></div>
                <div className={`absolute top-1/2 left-0 h-1 bg-blue-600 -z-10 rounded-full transition-all duration-500`} style={{ width: `${((step - 1) / 2) * 100}%` }}></div>
                {[1, 2, 3].map((s) => (
                    <div key={s} className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${step >= s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {s}
                    </div>
                ))}
            </div>

            <AnimatePresence mode="wait">

                {/* STEP 1: Business Info + Carrier */}
                {step === 1 && (
                    <motion.div
                        key="step1"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                    >
                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle>Set up your business</CardTitle>
                                <CardDescription>Enter your info and we will connect everything automatically.</CardDescription>
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

                                    <div className="space-y-2">
                                        <Label htmlFor="carrier">Phone Carrier</Label>
                                        <Select onValueChange={(val) => businessForm.setValue('carrier', val)}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select your carrier" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Verizon">Verizon</SelectItem>
                                                <SelectItem value="AT&T">AT&amp;T</SelectItem>
                                                <SelectItem value="T-Mobile">T-Mobile</SelectItem>
                                                <SelectItem value="Other">Other</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {businessForm.formState.errors.carrier && <p className="text-xs text-red-500">{businessForm.formState.errors.carrier.message}</p>}
                                    </div>

                                    {/* Connection Error */}
                                    {verificationError && (
                                        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                                            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                                            <div>
                                                <p className="text-sm text-red-800 font-medium">Connection Failed</p>
                                                <p className="text-sm text-red-600 mt-1">{verificationError}</p>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                                <CardFooter>
                                    <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={isConnecting}>
                                        {isConnecting ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Setting up...
                                            </>
                                        ) : (
                                            'Continue'
                                        )}
                                    </Button>
                                </CardFooter>
                            </form>
                        </Card>
                    </motion.div>
                )}

                {/* STEP 2: Activate Call Forwarding */}
                {step === 2 && (
                    <motion.div
                        key="step2"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                    >
                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle>Activate Call Forwarding</CardTitle>
                                <CardDescription>One quick dial from your business phone and you are all set.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Success banner */}
                                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                                    <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-sm text-green-800 font-medium">Phone Connected!</p>
                                        <p className="text-sm text-green-600 mt-1">Your business line is linked to LeadCatcher.</p>
                                    </div>
                                </div>

                                {/* Dial code */}
                                <div className="bg-slate-50 p-6 rounded-xl border border-dashed border-slate-300 text-center">
                                    <p className="text-sm text-slate-500 mb-1">Pick up your business phone and dial:</p>
                                    <div className="text-3xl font-mono font-bold text-slate-900 tracking-wider flex items-center justify-center gap-3 mt-2">
                                        {carrier === 'Verizon' ? '*71' : '*72'} {formatPhoneDisplay(forwardingNumber)}
                                        <Button variant="ghost" size="icon" onClick={handleCopyCode} aria-label="Copy forwarding code"><Copy size={16} /></Button>
                                    </div>
                                </div>

                                {/* Explanation */}
                                <div className="bg-blue-50 p-4 rounded-lg flex items-start gap-3">
                                    <div className="bg-blue-100 p-2 rounded-full text-blue-600">
                                        <Phone size={16} />
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-blue-900 text-sm">What does this do?</h4>
                                        <p className="text-xs text-blue-700 mt-1">
                                            This tells your carrier to forward calls to LeadCatcher <strong>only when you don&apos;t answer</strong>. Your phone still rings normally — we only catch the ones you miss.
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="flex gap-2">
                                <Button variant="outline" className="w-full" onClick={() => setStep(1)}>Back</Button>
                                <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => setStep(3)}>I dialed the code</Button>
                            </CardFooter>
                        </Card>
                    </motion.div>
                )}

                {/* STEP 3: Verify */}
                {step === 3 && (
                    <motion.div
                        key="step3"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                    >
                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle>{isVerified ? 'You are all set!' : 'Verify It Works'}</CardTitle>
                                <CardDescription>
                                    {isVerified
                                        ? 'Your missed calls are now being caught by LeadCatcher.'
                                        : 'We will call your business phone. Let it ring — do not answer — so the call forwards to us.'
                                    }
                                </CardDescription>
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
                                        {isVerifying && <p className="text-slate-600 font-medium">Calling your business phone...</p>}
                                        {isVerifying && <p className="text-xs text-slate-400 mt-1">Do not answer — let it forward.</p>}
                                        {!isVerifying && !verificationError && <p className="text-slate-500">Ready to test?</p>}
                                        {verificationError && (
                                            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-4 text-left flex items-start gap-3">
                                                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                                                <p className="text-sm text-red-600">{verificationError}</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="flex gap-2">
                                {!isVerified ? (
                                    <>
                                        <Button variant="outline" className="w-full" onClick={() => setStep(2)} disabled={isVerifying}>Back</Button>
                                        <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={runTestCall} disabled={isVerifying}>
                                            {isVerifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Phone className="mr-2 h-4 w-4" />}
                                            {isVerifying ? 'Calling...' : 'Run Test Call'}
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
