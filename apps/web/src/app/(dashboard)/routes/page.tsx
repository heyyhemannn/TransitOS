'use client';

import * as React from 'react';
import { Route as RouteIcon, MapPin, Compass, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function RoutesPage() {
  return (
    <div className="flex flex-col gap-6 py-6" suppressHydrationWarning>
      {/* Page Header */}
      <div suppressHydrationWarning>
        <h2 className="text-xl font-bold tracking-tight" suppressHydrationWarning>
          Route Management
        </h2>
        <p className="text-sm text-muted-foreground" suppressHydrationWarning>
          Plan, track, and optimize your student transportation pathways
        </p>
      </div>

      {/* Feature Coming Soon Hero Card */}
      <Card
        className="relative overflow-hidden border-slate-800 bg-slate-900/20 backdrop-blur-md"
        suppressHydrationWarning
      >
        <div
          className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_-10%,rgba(59,130,246,0.08),rgba(255,255,255,0))]"
          suppressHydrationWarning
        />

        <CardContent
          className="relative z-10 flex flex-col items-center justify-center py-20 text-center"
          suppressHydrationWarning
        >
          {/* Animated Icon Ring */}
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary mb-6 animate-pulse"
            suppressHydrationWarning
          >
            <Compass className="h-10 w-10 stroke-[1.5]" />
          </div>

          <span
            className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20 mb-4"
            suppressHydrationWarning
          >
            Feature Launching Soon
          </span>

          <h1
            className="text-4xl font-extrabold tracking-tight text-slate-100 max-w-lg mb-4"
            suppressHydrationWarning
          >
            Intelligent Live Route Planning & Optimizations
          </h1>

          <p
            className="text-slate-400 text-sm max-w-md mb-8 leading-relaxed"
            suppressHydrationWarning
          >
            We are engineering a state-of-the-art GPS mapping system. Soon, you will be able to build dynamic routes, assign drivers, optimize stops, and send real-time bus arrivals directly to parents.
          </p>

          <div className="flex gap-4" suppressHydrationWarning>
            <Button className="gap-2 font-bold cursor-not-allowed opacity-60">
              Request Early Access
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Coming Soon Highlights */}
      <div className="grid gap-6 md:grid-cols-3" suppressHydrationWarning>
        <Card className="border-slate-800 bg-slate-900/30" suppressHydrationWarning>
          <CardContent className="pt-6 space-y-3" suppressHydrationWarning>
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500"
              suppressHydrationWarning
            >
              <RouteIcon className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-slate-200" suppressHydrationWarning>
              Dynamic Route Optimizer
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed" suppressHydrationWarning>
              Automatically compute the fastest, fuel-efficient paths avoiding school zone traffic jams in real time.
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/30" suppressHydrationWarning>
          <CardContent className="pt-6 space-y-3" suppressHydrationWarning>
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500"
              suppressHydrationWarning
            >
              <MapPin className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-slate-200" suppressHydrationWarning>
              Parent Pick-up Notifications
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed" suppressHydrationWarning>
              Automated alerts when the vehicle reaches a 2 km radius, ensuring kids are ready without delayed stops.
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/30" suppressHydrationWarning>
          <CardContent className="pt-6 space-y-3" suppressHydrationWarning>
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500"
              suppressHydrationWarning
            >
              <Compass className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-slate-200" suppressHydrationWarning>
              Driver Verification Logs
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed" suppressHydrationWarning>
              Log sheet audits mapping vehicle speeds, boarding status, and general security trip schedules.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
