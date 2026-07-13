"use client";

import React, { useRef } from "react";
import { cn } from "@/lib/utils";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, children, className, ...props }: PageHeaderProps) {
  const container = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    gsap.fromTo(
      container.current,
      { y: -30, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" }
    );
  }, { scope: container });

  return (
    <div
      ref={container}
      className={cn(
        "flex flex-col gap-2 md:flex-row md:items-center md:justify-between border-b border-border/50 pb-4 mb-6",
        className
      )}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground drop-shadow-sm">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2 mt-2 md:mt-0">{children}</div>}
    </div>
  );
}
