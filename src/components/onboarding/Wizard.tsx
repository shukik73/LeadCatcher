"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion, AnimatePresence } from 'framer-motion';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';
import { toast } from 'sonner';
import { CheckCircle2, Phone, Loader2, Copy } from 'lucide-react';

// Validation Schemas

const businessSchema = z.object({
    businessName: z.string().min(2, "Business name is required"),
    businessPhone: z.string().min(10, "Valid phone number required").regex(/^\+?1?\d{10,14}$/, "Invalid phone format"),
    ownerPhone: z.string().min(10, "Valid mobile number required").regex(/^\+?1?\d{10,14}$/, "Invalid phone format"),
});

const carrierSchema = z.object({
    carrier: z.string().min(1, "Please select a carrier"),
});

type BusinessFormData = z.infer<typeof businessSchema>;
type CarrierFormData = z.infer<typeof carrierSchema>;

export default function Wizard() {
    const [step, setStep] = useState(1);
    const [forwardingNumber, setForwardingNumber] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [isVerified, setIsVerified] = useState(false);
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

    // Derived state
    const carrier = carrierForm.watch('carrier');

    // We need a user hook or just fetch user
    // const { user } = useUser(); // Assuming a user hook like Clerk's useUser

    // Handlers
    const onBusinessSubmit = async (data: BusinessFormData) => {
        // 1. Create Business in DB
        // RLS Policy says: "Users can create own business" (auth.uid() = user_id)

        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            toast.error("You must be logged in");
            return;
        }

        // Generate a mock forwarding number for this user if not exists
        // In real app, we would buy a number via Twilio API here
        const mockNumber = '+1 (786) 555-' + Math.floor(1000 + Math.random() * 9000);
        setForwardingNumber(mockNumber);

        const { data: business, error } = await supabase.from('businesses').upsert({
            user_id: user.id,
            name: data.businessName,
            business_phone: data.businessPhone,
            owner_phone: data.ownerPhone,
            forwarding_number: mockNumber,
            carrier: 'Pending' // Will update in next step
        }, { onConflict: 'user_id' }).select().single();

        if (error) {
            console.error(error);
            toast.error("Failed to save business");
            return;
        }

        setStep(2);
    };

    const onCarrierSubmit = async (data: CarrierFormData) => {
        // Update carrier
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            await supabase.from('businesses').update({ carrier: data.carrier }).eq('user_id', user.id);
        }
        setStep(3);
    };

    const handleCopyCode = () => {
        navigator.clipboard.writeText(`*72${forwardingNumber.replace(/\D/g, '')}`);
        // Show toast
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

    return (
        <div className="max-w-xl mx-auto">
            {/* Progress Bar */}
            <div className="mb-8 flex justify-between relative" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={4} aria-label={`Onboarding progress: step ${step} of 4`}>
                <div className="absolute top-1/2 left-0 w-full h-1 bg-slate-100 -z-10 rounded-full"></div>
                <div className={`absolute top-1/2 left-0 h-1 bg-blue-600 -z-10 rounded-full transition-all duration-500`} style={{ width: `${((step - 1) / 4) * 100}%` }}></div>
                {[1, 2, 3, 4].map((s) => (
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
                                        <p className="text-xs text-slate-500">We'll text this number when you miss a call.</p>
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

                {/* STEP 3: Setup Instructions */}
                {step === 3 && (
                    <motion.div
                        key="step3"
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
                                        *72 {forwardingNumber}
                                        <Button variant="ghost" size="icon" onClick={handleCopyCode}><Copy size={16} /></Button>
                                    </div>
                                </div>
                                <div className="bg-blue-50 p-4 rounded-lg flex items-start gap-3">
                                    <div className="bg-blue-100 p-2 rounded-full text-blue-600">
                                        <Phone size={16} />
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-blue-900 text-sm">Conditional Forwarding</h4>
                                        <p className="text-xs text-blue-700 mt-1">This specific code ({carrier === 'Verizon' ? '*71' : '*72'}) only forwards calls when you don't answer or are busy. Your phone still rings!</p>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="flex gap-2">
                                <Button variant="outline" className="w-full" onClick={() => setStep(2)}>Back</Button>
                                <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => setStep(4)}>I've dialed the code</Button>
                            </CardFooter>
                        </Card>
                    </motion.div>
                )}

                {/* STEP 4: Verify */}
                {step === 4 && (
                    <motion.div
                        key="step4"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                    >
                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle>Testing Connection...</CardTitle>
                                <CardDescription>We'll give your business line a call to make sure forwarding works.</CardDescription>
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
                                        <Button variant="outline" className="w-full" onClick={() => setStep(3)} disabled={isVerifying}>Back</Button>
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
