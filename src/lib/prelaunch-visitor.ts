const VISITOR_KEY = "sooq_prelaunch_visitor";
const VOTES_KEY = "sooq_prelaunch_votes";

export function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

export function getLocalVotes(): Record<string, "yes" | "no"> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(VOTES_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveLocalVote(questionId: string, vote: "yes" | "no") {
  const votes = getLocalVotes();
  votes[questionId] = vote;
  localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
}
