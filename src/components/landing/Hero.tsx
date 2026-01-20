"use client";

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { ArrowRight, Phone, CheckCircle2 } from 'lucide-react';

export default function Hero() {
    return (
        <section className="relative pt-32 pb-24 lg:pt-48 lg:pb-32 overflow-hidden bg-gradient-to-b from-blue-50/50 to-white">
            {/* Background Decor */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full -z-10 pointer-events-none">
                <div className="absolute top-20 left-10 w-72 h-72 bg-blue-200/20 rounded-full blur-[100px]" />
                <div className="absolute top-40 right-10 w-96 h-96 bg-purple-200/20 rounded-full blur-[100px]" />
            </div>

            <div className="container px-4 md:px-6 mx-auto text-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900/5 text-slate-600 text-sm font-medium mb-8 border border-slate-200"
                >
                    <span className="flex h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                    Built for Auto Repair, HVAC & Contractors
                </motion.div>

                <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="text-5xl md:text-7xl font-bold tracking-tight text-slate-900 mb-6 max-w-4xl mx-auto"
                >
                    Stop losing jobs to <br />
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">missed calls.</span>
                </motion.h1>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="text-xl md:text-2xl text-slate-500 mb-10 max-w-2xl mx-auto leading-relaxed"
                >
                    Instantly text back every caller you miss. Keep the lead warm and secure the job while you&apos;re busy on-site.
                </motion.p>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20"
                >
                    <Button asChild size="lg" className="h-14 px-8 text-lg rounded-full bg-blue-600 hover:bg-blue-700 shadow-xl shadow-blue-200 hover:shadow-2xl hover:shadow-blue-300 transition-all">
                        <Link href="/onboarding">
                            Start Free Trial <ArrowRight className="ml-2 h-5 w-5" />
                        </Link>
                    </Button>
                    <Button asChild variant="outline" size="lg" className="h-14 px-8 text-lg rounded-full border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                        <Link href="#how-it-works">
                            See How It Works
                        </Link>
                    </Button>
                </motion.div>

                {/* Demo UI */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.8, delay: 0.4 }}
                    className="relative max-w-4xl mx-auto"
                >
                    <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent z-10 h-full w-full pointer-events-none" />

                    <div className="bg-white rounded-[2rem] p-4 shadow-[0_30px_100px_-20px_rgba(0,0,0,0.15)] border border-slate-200/60 backdrop-blur-xl">
                        <div className="bg-slate-50 rounded-[1.5rem] p-8 md:p-12 border border-slate-100 flex flex-col md:flex-row items-center gap-12">

                            {/* Visualizing the flow */}
                            <div className="flex-1 space-y-6 w-full">
                                <div className="flex items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                                    <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                                        <Phone size={24} />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Missed Call</p>
                                        <p className="font-semibold text-slate-900">(555) 123-4567</p>
                                    </div>
                                </div>
                            </div>

                            <ArrowRight className="text-slate-300 rotate-90 md:rotate-0 h-8 w-8" />

                            <div className="flex-1 space-y-6 w-full">
                                <div className="bg-blue-600 p-5 rounded-2xl rounded-tr-sm shadow-lg text-left text-white relative">
                                    <p className="text-sm font-medium leading-relaxed">
                                        &ldquo;Hey! Sorry I missed your call at Techy Miramar. How can we help you today?&rdquo;
                                    </p>
                                    <div className="mt-2 flex items-center gap-2 text-blue-200 text-xs">
                                        <CheckCircle2 size={12} /> Sent automatically
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
}
