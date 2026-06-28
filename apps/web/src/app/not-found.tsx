'use client';

import Link from 'next/link';
import { Home } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function NotFound() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 text-center"
      suppressHydrationWarning
    >
      <div className="space-y-6" suppressHydrationWarning>
        <h1 className="text-9xl font-bold tracking-tight text-primary/20" suppressHydrationWarning>
          404
        </h1>
        <div className="space-y-2" suppressHydrationWarning>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100" suppressHydrationWarning>
            Page Not Found
          </h2>
          <p className="text-sm text-slate-400 max-w-md mx-auto" suppressHydrationWarning>
            The page you are looking for doesn't exist or is currently undergoing maintenance.
          </p>
        </div>
        <Link
          href="/dashboard"
          className={cn(buttonVariants({ variant: 'default' }), 'gap-2')}
          suppressHydrationWarning
        >
          <Home className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
