"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useUser } from "@/lib/auth/hooks";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { cn, timeAgo } from "@/lib/utils";
import { toast } from "sonner";
import type { Side } from "@/types/database";
import { Heart, MessageCircle, ChevronDown, ChevronUp, MoreHorizontal, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";

interface Comment {
  id: string;
  user_id: string;
  side: Side | null;
  body: string;
  parent_id: string | null;
  like_count: number;
  created_at: string;
  users: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  replies?: Comment[];
  liked_by_me?: boolean;
  parent_user_name?: string;
}


function CommentAvatar({ comment, size = "md" }: { comment: Comment; size?: "sm" | "md" }) {
  const s = size === "sm" ? "sm" : "md" as const;
  return (
    <Avatar
      name={comment.users?.display_name || "?"}
      userId={comment.user_id}
      src={comment.users?.avatar_url}
      size={s}
    />
  );
}

/** Inline reply input that appears under a comment */
function InlineReplyInput({
  parentName,
  onSubmit,
  onCancel,
}: {
  parentName: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("market");
  const [text, setText] = useState("");

  return (
    <div className="flex items-center gap-2 ms-12 mt-2 mb-1">
      <div className="flex-1 flex items-center gap-2 bg-bg border border-border-custom rounded-lg px-3 py-1.5 focus-within:border-yes/40 transition-colors">
        <span className="text-yes text-xs font-medium flex-shrink-0">@{parentName}</span>
        <input
          autoFocus
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 500))}
          placeholder={t("writeReply")}
          className="flex-1 bg-transparent text-sm text-text placeholder:text-dim focus:outline-none min-w-0"
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) onSubmit(text.trim());
            if (e.key === "Escape") onCancel();
          }}
        />
        <button
          onClick={() => text.trim() && onSubmit(text.trim())}
          disabled={!text.trim()}
          className={cn(
            "px-3 py-0.5 text-xs font-medium rounded-md transition-all cursor-pointer flex-shrink-0",
            text.trim()
              ? "bg-yes text-white hover:bg-yes/90"
              : "bg-elevated text-dim cursor-not-allowed"
          )}
        >
          {t("reply")}
        </button>
      </div>
      <button
        onClick={onCancel}
        className="text-dim hover:text-muted-custom cursor-pointer flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function ReplyItem({
  comment,
  userId,
  onLike,
}: {
  comment: Comment;
  userId: string | undefined;
  onLike: (commentId: string, liked: boolean) => void;
}) {
  const t = useTranslations("market");
  const name = comment.users?.display_name || t("anonymous");

  return (
    <div className="flex gap-2.5 py-3 ps-12 group/reply">
      <CommentAvatar comment={comment} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[12px] font-medium text-text">{name}</span>
          <span className="text-[11px] text-dim">{timeAgo(comment.created_at)}</span>
          <button className="ms-auto text-dim hover:text-muted-custom cursor-pointer opacity-0 group-hover/reply:opacity-100 transition-opacity" aria-label="More options">
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[13px] text-text/90 leading-relaxed">
          {comment.parent_user_name && (
            <span className="text-yes font-medium">@{comment.parent_user_name} </span>
          )}
          {comment.body}
        </p>
        <div className="flex items-center gap-3 mt-1.5">
          <button
            onClick={() => onLike(comment.id, !!comment.liked_by_me)}
            className={cn(
              "flex items-center gap-1 text-[11px] transition-colors cursor-pointer",
              comment.liked_by_me ? "text-no" : "text-dim hover:text-muted-custom"
            )}
          >
            <Heart className={cn("w-3 h-3", comment.liked_by_me && "fill-current")} />
            <span>{comment.like_count}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  userId,
  replyingTo,
  onReply,
  onSubmitReply,
  onCancelReply,
  onLike,
}: {
  comment: Comment;
  userId: string | undefined;
  replyingTo: string | null;
  onReply: (parentId: string) => void;
  onSubmitReply: (parentId: string, body: string) => void;
  onCancelReply: () => void;
  onLike: (commentId: string, liked: boolean) => void;
}) {
  const t = useTranslations("market");
  const [showReplies, setShowReplies] = useState(false);
  const replies = comment.replies || [];
  const name = comment.users?.display_name || t("anonymous");
  const isReplying = replyingTo === comment.id;

  // Auto-expand replies when replying
  useEffect(() => {
    if (isReplying && replies.length > 0) setShowReplies(true);
  }, [isReplying, replies.length]);

  return (
    <div className="py-4">
      {/* Main comment */}
      <div className="flex gap-3 group/comment">
        <CommentAvatar comment={comment} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[13px] font-medium text-text">{name}</span>
            {comment.side && (
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                  comment.side === "yes"
                    ? "bg-yes/15 text-yes"
                    : "bg-no/15 text-no"
                )}
              >
                {comment.side}
              </span>
            )}
            <span className="text-[11px] text-dim">{timeAgo(comment.created_at)}</span>
            <button className="ms-auto text-dim hover:text-muted-custom cursor-pointer opacity-0 group-hover/comment:opacity-100 transition-opacity" aria-label="More options">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>

          <p className="text-[13px] text-text/90 leading-relaxed mb-2">{comment.body}</p>

          <div className="flex items-center gap-4">
            <button
              onClick={() => onLike(comment.id, !!comment.liked_by_me)}
              className={cn(
                "flex items-center gap-1 text-[11px] transition-colors cursor-pointer",
                comment.liked_by_me ? "text-no" : "text-dim hover:text-muted-custom"
              )}
            >
              <Heart className={cn("w-3.5 h-3.5", comment.liked_by_me && "fill-current")} />
              <span>{comment.like_count}</span>
            </button>
            <button
              onClick={() => onReply(comment.id)}
              className="flex items-center gap-1 text-[11px] text-dim hover:text-muted-custom transition-colors cursor-pointer"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>{t("reply")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Inline reply input — appears under this comment */}
      {isReplying && (
        <InlineReplyInput
          parentName={name}
          onSubmit={(body) => onSubmitReply(comment.id, body)}
          onCancel={onCancelReply}
        />
      )}

      {/* Replies section */}
      {replies.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowReplies(!showReplies)}
            className="flex items-center gap-1.5 text-[12px] text-yes font-medium ms-12 cursor-pointer hover:text-yes/80 transition-colors"
          >
            {showReplies ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {t("repliesCount", { count: replies.length })}
          </button>

          {showReplies && (
            <div className="mt-1">
              {replies.map((reply) => (
                <div key={reply.id}>
                  <ReplyItem comment={reply} userId={userId} onLike={onLike} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MarketComments({ marketId }: { marketId: string }) {
  const t = useTranslations("market");
  const supabase = useSupabase();
  const { user } = useUser();
  const profile = user;
  const { openLoginModal } = useAuthModal();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [myLikes, setMyLikes] = useState<Set<string>>(new Set());
  const [mySide, setMySide] = useState<Side | null>(null);

  const buildTree = useCallback((flat: Comment[], likedSet: Set<string>): Comment[] => {
    const map = new Map<string, Comment>();
    const roots: Comment[] = [];

    for (const c of flat) {
      map.set(c.id, { ...c, replies: [], liked_by_me: likedSet.has(c.id) });
    }

    for (const c of map.values()) {
      if (c.parent_id && map.has(c.parent_id)) {
        const parent = map.get(c.parent_id)!;
        c.parent_user_name = parent.users?.display_name || t("anonymous");
        parent.replies!.push(c);
      } else {
        roots.push(c);
      }
    }

    roots.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    for (const r of map.values()) {
      r.replies?.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }

    return roots;
  }, []);

  // Fetch user's position to auto-set side
  useEffect(() => {
    if (!user) { setMySide(null); return; }

    supabase
      .from("positions")
      .select("side, shares_held")
      .eq("user_id", user.id)
      .eq("market_id", marketId)
      .gt("shares_held", 0)
      .order("shares_held", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setMySide(data[0].side as Side);
        } else {
          setMySide(null);
        }
      });
  }, [supabase, user?.id, marketId]);

  useEffect(() => {
    async function fetchComments() {
      const { data } = await supabase
        .from("market_comments")
        .select("*, users(display_name, avatar_url)")
        .eq("market_id", marketId)
        .order("created_at", { ascending: false })
        .limit(100);

      let likedSet = new Set<string>();
      if (user) {
        const commentIds = (data || []).map((c: any) => c.id);
        if (commentIds.length > 0) {
          const { data: likes } = await supabase
            .from("comment_likes")
            .select("comment_id")
            .eq("user_id", user.id)
            .in("comment_id", commentIds);
          likedSet = new Set((likes || []).map((l: any) => l.comment_id));
        }
      }

      setMyLikes(likedSet);
      if (data) setComments(data as unknown as Comment[]);
      setLoading(false);
    }

    fetchComments();

    const channel = supabase
      .channel(`comments-${marketId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "market_comments", filter: `market_id=eq.${marketId}` },
        async (payload) => {
          const newComment = payload.new as any;
          const { data: userData } = await supabase
            .from("users")
            .select("display_name, avatar_url")
            .eq("id", newComment.user_id)
            .single();

          const commentWithUser: Comment = { ...newComment, users: userData };
          setComments((prev) => {
            if (prev.some((c) => c.id === commentWithUser.id)) return prev;
            return [commentWithUser, ...prev];
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, marketId, user?.id]);

  /** Submit a top-level comment */
  const handleSubmit = async () => {
    if (!user || !body.trim()) return;
    setSubmitting(true);

    const newComment: Comment = {
      id: crypto.randomUUID(),
      user_id: user.id,
      side: mySide,
      body: body.trim(),
      parent_id: null,
      like_count: 0,
      created_at: new Date().toISOString(),
      users: {
        display_name: profile?.display_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
      },
    };

    setComments((prev) => [newComment, ...prev]);
    setBody("");

    const { error } = await supabase.from("market_comments").insert({
      id: newComment.id,
      market_id: marketId,
      user_id: user.id,
      side: mySide,
      body: newComment.body,
      parent_id: null,
    });

    if (error) {
      setComments((prev) => prev.filter((c) => c.id !== newComment.id));
      toast.error("Failed to post comment");
    }

    setSubmitting(false);
  };

  /** Submit an inline reply */
  const handleSubmitReply = async (parentId: string, replyBody: string) => {
    if (!user || !replyBody.trim()) return;

    const newReply: Comment = {
      id: crypto.randomUUID(),
      user_id: user.id,
      side: mySide,
      body: replyBody.trim(),
      parent_id: parentId,
      like_count: 0,
      created_at: new Date().toISOString(),
      users: {
        display_name: profile?.display_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
      },
    };

    setComments((prev) => [newReply, ...prev]);
    setReplyingTo(null);

    const { error } = await supabase.from("market_comments").insert({
      id: newReply.id,
      market_id: marketId,
      user_id: user.id,
      side: mySide,
      body: newReply.body,
      parent_id: parentId,
    });

    if (error) {
      setComments((prev) => prev.filter((c) => c.id !== newReply.id));
      toast.error("Failed to post reply");
    }
  };

  const handleLike = async (commentId: string, alreadyLiked: boolean) => {
    if (!user) { openLoginModal(); return; }

    setMyLikes((prev) => {
      const next = new Set(prev);
      if (alreadyLiked) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? { ...c, like_count: c.like_count + (alreadyLiked ? -1 : 1) }
          : c
      )
    );

    const { error } = alreadyLiked
      ? await supabase.from("comment_likes").delete().eq("comment_id", commentId).eq("user_id", user.id)
      : await supabase.from("comment_likes").insert({ comment_id: commentId, user_id: user.id });

    if (error) {
      // Rollback optimistic update
      setMyLikes((prev) => {
        const next = new Set(prev);
        if (alreadyLiked) next.add(commentId);
        else next.delete(commentId);
        return next;
      });
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, like_count: c.like_count + (alreadyLiked ? 1 : -1) }
            : c
        )
      );
    }
  };

  const handleReply = (parentId: string) => {
    if (!user) { openLoginModal(); return; }
    setReplyingTo(parentId);
  };

  const tree = buildTree(comments, myLikes);
  const totalCount = comments.length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-base font-medium font-satoshi text-text">
          {totalCount > 0 ? t("commentsCount", { count: totalCount }) : t("comments")}
        </h3>
      </div>

      {/* Top-level comment input */}
      {user ? (
        <div className="mb-2">
          <div className="flex items-center gap-2 bg-surface border border-border-custom rounded-xl px-3 py-2 focus-within:border-yes/40 transition-colors">
            <input
              type="text"
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 500))}
              placeholder={t("addComment")}
              className="flex-1 bg-transparent text-sm text-text placeholder:text-dim focus:outline-none min-w-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && body.trim()) handleSubmit();
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={!body.trim() || submitting}
              className={cn(
                "px-3.5 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer flex-shrink-0",
                body.trim()
                  ? "bg-yes text-white hover:bg-yes/90"
                  : "bg-elevated text-dim cursor-not-allowed"
              )}
            >
              {t("post")}
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={openLoginModal}
          className="mb-2 flex items-center bg-surface border border-border-custom rounded-xl px-4 py-3 cursor-pointer hover:border-yes/30 transition-colors"
        >
          <span className="text-sm text-dim">{t("addComment")}</span>
          <span className="ms-auto px-3 py-1 bg-elevated text-dim text-xs font-medium rounded-lg">{t("post")}</span>
        </div>
      )}

      {/* Comments list */}
      {loading ? (
        <div className="space-y-4 mt-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="w-9 h-9 rounded-full bg-bg/50 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-24 bg-bg/50 rounded animate-pulse" />
                <div className="h-4 w-full bg-bg/50 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : tree.length === 0 ? (
        <p className="text-center text-sm text-dim py-8">{t("noComments")}</p>
      ) : (
        <div className="divide-y divide-border-custom">
          {tree.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              userId={user?.id}
              replyingTo={replyingTo}
              onReply={handleReply}
              onSubmitReply={handleSubmitReply}
              onCancelReply={() => setReplyingTo(null)}
              onLike={handleLike}
            />
          ))}
        </div>
      )}
    </div>
  );
}
