"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "lucide-react";
import { NetworkNode } from "./network-node";
import type { AgentNetworkNode } from "@/types/agent";

interface NetworkTreeProps {
  tree: AgentNetworkNode[];
  loading: boolean;
}

export function NetworkTree({ tree, loading }: NetworkTreeProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="text-center py-12 relative overflow-hidden rounded-xl">
        <div className="grid-dots absolute inset-0 opacity-20 pointer-events-none" />
        <div className="relative">
          <div className="w-12 h-12 bg-elevated rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Users className="w-6 h-6 text-dim" />
          </div>
          <p className="text-muted-custom text-sm font-dm-sans">No referrals yet</p>
          <p className="text-dim text-xs font-dm-sans mt-1">
            Share your referral link to start building your network
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tree.map((node) => (
        <NetworkNode key={node.id} node={node} />
      ))}
    </div>
  );
}
