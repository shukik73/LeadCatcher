"use client";

export default function Testimonial() {
    return (
        <section className="bg-[#16120B] py-24">
            <div className="container mx-auto max-w-3xl px-4 text-center md:px-6">
                <blockquote className="text-2xl font-medium leading-relaxed text-stone-100 md:text-3xl">
                    &ldquo;I booked two jobs the first afternoon — from calls I never would&apos;ve even known about. It pays for itself.&rdquo;
                </blockquote>
                <div className="mt-8 flex items-center justify-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#E0A43B]/15 text-sm font-bold text-[#E0A43B]">MR</span>
                    <div className="text-left">
                        <p className="font-semibold text-stone-50">Mara Reyes</p>
                        <p className="text-sm text-stone-400">Ridgeline Plumbing · Phoenix, AZ</p>
                    </div>
                </div>
            </div>
        </section>
    );
}
