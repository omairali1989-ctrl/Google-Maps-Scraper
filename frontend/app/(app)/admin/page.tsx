"use client";

import React, { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, Trash2, ShieldCheck, ScrollText, UserPlus } from "lucide-react";
import { toast } from "sonner";

interface User {
  id: number;
  username: string;
  email: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
}

interface AuditEntry {
  id: number;
  username: string | null;
  ip: string | null;
  action: string;
  resource: string | null;
  created_at: string;
}

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [forbidden, setForbidden] = useState(false);

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");

  const loadUsers = async () => {
    const res = await fetch("/api/v2/users");
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      return;
    }
    if (res.ok) setUsers(await res.json());
  };

  const loadAudit = async () => {
    const res = await fetch("/api/v2/audit?limit=100");
    if (res.ok) setAudit(await res.json());
  };

  useEffect(() => {
    loadUsers();
    loadAudit();
  }, []);

  const createUser = async () => {
    if (!newUsername.trim() || newPassword.length < 6) {
      toast.error("Username and a 6+ character password are required.");
      return;
    }
    const res = await fetch("/api/v2/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: newUsername.trim(),
        password: newPassword,
        role: newRole,
      }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      toast.success("User created");
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      loadUsers();
      loadAudit();
    } else {
      toast.error(data.error || "Failed to create user");
    }
  };

  const deleteUser = async (id: number) => {
    const res = await fetch(`/api/v2/users/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) {
      toast.success("User deleted");
      loadUsers();
      loadAudit();
    } else {
      toast.error(data.error || "Failed to delete user");
    }
  };

  const toggleRole = async (u: User) => {
    const nextRole = u.role === "admin" ? "user" : "admin";
    const res = await fetch(`/api/v2/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
    if (res.ok) {
      toast.success(`Role set to ${nextRole}`);
      loadUsers();
    } else {
      toast.error("Failed to update role");
    }
  };

  if (forbidden) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Administration" description="Restricted area." />
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            You do not have permission to view this page.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Administration"
        description="Manage users, roles, and review the system audit log."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User management */}
        <Card className="shadow-sm border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="size-4" /> Users
            </CardTitle>
            <CardDescription>Create, promote, or remove accounts.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 p-3 rounded-lg border border-border/50 bg-muted/30">
              <span className="text-xs font-semibold flex items-center gap-1.5">
                <UserPlus className="size-3.5" /> New user
              </span>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="Username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                />
                <Input
                  type="password"
                  placeholder="Password (6+ chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <Select value={newRole} onValueChange={(v) => setNewRole(v || "user")}>
                  <SelectTrigger className="sm:w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={createUser}>
                Create user
              </Button>
            </div>

            <ul className="flex flex-col divide-y divide-border/50">
              {users.map((u) => (
                <li key={u.id} className="flex items-center justify-between py-2">
                  <span className="flex flex-col">
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      {u.username}
                      {u.role === "admin" && (
                        <ShieldCheck className="size-3.5 text-primary" />
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {u.email || "no email"} · {u.role}
                      {u.is_active ? "" : " · disabled"}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => toggleRole(u)}
                    >
                      {u.role === "admin" ? "Demote" : "Promote"}
                    </Button>
                    <button
                      onClick={() => deleteUser(u.id)}
                      className="text-muted-foreground hover:text-red-500"
                      title="Delete user"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Audit log */}
        <Card className="shadow-sm border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ScrollText className="size-4" /> Audit Log
            </CardTitle>
            <CardDescription>Recent security-relevant actions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground text-left sticky top-0 bg-card">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">When</th>
                    <th className="py-1.5 pr-2 font-medium">User</th>
                    <th className="py-1.5 pr-2 font-medium">Action</th>
                    <th className="py-1.5 font-medium">Resource</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id} className="border-t border-border/40">
                      <td className="py-1.5 pr-2 whitespace-nowrap text-muted-foreground">
                        {a.created_at}
                      </td>
                      <td className="py-1.5 pr-2">{a.username || "—"}</td>
                      <td className="py-1.5 pr-2 font-medium">{a.action}</td>
                      <td className="py-1.5 text-muted-foreground truncate max-w-[140px]">
                        {a.resource || ""}
                      </td>
                    </tr>
                  ))}
                  {audit.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-muted-foreground">
                        No audit entries yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
