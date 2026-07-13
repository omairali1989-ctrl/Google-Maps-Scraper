"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { MapPin, LogIn } from "lucide-react";

export default function LoginPage() {
  // useSearchParams must be under a Suspense boundary for static generation.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") || "/dashboard";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error("Enter your username and password.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/v2/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, remember }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Welcome back, ${data.user.username}.`);
        // Full navigation so middleware re-reads the fresh session cookie.
        window.location.href = nextUrl;
      } else {
        toast.error(data.error || "Login failed.");
      }
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm shadow-lg border-border/60">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MapPin className="size-6" />
          </div>
          <CardTitle className="text-xl font-bold">Extractrix</CardTitle>
          <CardDescription>Sign in to your scraping dashboard</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="username" className="text-xs font-semibold text-muted-foreground">
                Username
              </label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-xs font-semibold text-muted-foreground">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Remember me</span>
              <Switch checked={remember} onCheckedChange={setRemember} />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              <LogIn className="size-4 mr-1.5" />
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            First run? Default admin is <span className="font-mono">admin / admin</span>.
            Change it in Settings after signing in.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
