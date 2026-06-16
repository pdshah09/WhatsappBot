// not-found.tsx

import React from 'react';
// import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-screen bg-zinc-950 place-items-center px-2 py-24 sm:py-12 lg:px-6 selection:bg-foreground selection:text-black">
      
      <div className="text-center">
        {/* Minimal Trendy Badge */}
        {/* <DotLottieReact
          src="https://lottie.host/1bec03fd-3060-49c6-9b86-a9f31a157fa7/BlyXcGaZFm.lottie"
          loop
          autoplay
        /> */}
        <p className="text-xs font-mono font-semibold tracking-widest text-canvas uppercase">
          Error 404
        </p>
        
        {/* Large Typography Headings */}
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-canvas sm:text-6xl">
          Page not found
        </h1>
        
        <p className="mt-6 text-base leading-7 text-canvas max-w-md mx-auto">
          The page you are looking for does not exist.
        </p>
        
        {/* Micro-interactive Action Button */}
        <div className="mt-10 flex items-center justify-center gap-x-6">
          <Link
            href="/"
            className="rounded-full bg-brand px-6 py-2.5 text-sm font-medium text-main shadow-sm hover:bg-amber-200 transition-all duration-200 active:scale-95"
          >
            Back to home
          </Link>
        </div>
      </div>
      
    </main>
  );
}