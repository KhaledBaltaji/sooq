"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import type { AgentNetworkNode } from "@/types/agent";

interface NetworkNodeProps {
  node: AgentNetworkNode;
}

const LAYER_STYLES = {
  1: { bg: "bg-yes/10", text: "text-yes", border: "border-yes/30", label: "L1" },
  2: { bg: "bg-warning/10", text: "text-warning", border: "border-warning/30", label: "L2" },
  3: { bg: "bg-elevated", text: "text-muted-custom", border: "border-border-custom", label: "L3" },
} as const;

export function NetworkNode({ node }: NetworkNodeProps) {
  const [expanded, setExpanded] = useState(node.layer === 1);
  const hasChildren = node.children && node.children.length > 0;
  const style = LAYER_STYLES[node.layer];

  return (
    <div className="space-y-0">
      <button
        onClick={() => hasChildren && setExpanded(!expanded)}
        className={cn(
          "w-full bg-bg border border-border-custom rounded-xl p-3 flex items-center gap-3 text-left transition-all duration-200",
          hasChildren ? "hover:bg-elevated/50 hover:-translate-y-0.5 cursor-pointer" : "cursor-default"
        )}
      >
        {/* Layer badge */}
        <div className={`w-9 h-9 rounded-full ${style.bg} border ${style.border} flex items-center justify-center shrink-0`}>
          <span className={`${style.text} text-xs font-bold font-satoshi`}>{style.label}</span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text font-dm-sans truncate">
            {node.display_name || "Anonymous"}
          </p>
          <p className="text-xs text-muted-custom font-dm-sans">
            L{node.agent_level} · {node.referral_count} refs · {node.trade_count} trades
          </p>
        </div>

        {/* Revenue / Commission */}
        <div className="text-right shrink-0">
          <p
            className="text-xs text-success font-satoshi font-bold tabular-nums"
            style={{ textShadow: "0 0 8px rgba(0, 232, 123, 0.2)" }}
          >
            +{formatCurrency(node.commission_earned)}
          </p>
          <p className="text-[10px] text-muted-custom tabular-nums font-dm-sans">
            {formatCurrency(node.revenue_generated)} rev
          </p>
        </div>

        {/* Expand chevron */}
        {hasChildren && (
          <div className="text-muted-custom shrink-0">
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </div>
        )}
      </button>

      {/* Children */}
      <AnimatePresence>
        {expanded && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="ms-6 ps-4 border-s border-border-custom/40 space-y-2 pt-2">
              {node.children.map((child) => (
                <NetworkNode key={child.id} node={child} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
