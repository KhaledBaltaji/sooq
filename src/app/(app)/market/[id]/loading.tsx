import { Skeleton } from "@/components/ui/skeleton";

export default function MarketDetailLoading() {
  return (
    <div className="px-md py-lg space-y-md max-w-3xl mx-auto">
      {/* Back button */}
      <Skeleton className="h-5 w-16" />

      {/* Market image */}
      <Skeleton className="h-44 w-full rounded-xl" />

      {/* Title + status */}
      <div className="space-y-sm">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
      </div>

      {/* Stats row (volume, traders, deadline) */}
      <div className="flex gap-md">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-24" />
      </div>

      {/* Price chart placeholder */}
      <Skeleton className="h-[200px] w-full rounded-lg" />

      {/* Trade panel placeholder */}
      <div className="space-y-sm">
        <div className="flex gap-sm">
          <Skeleton className="h-12 flex-1 rounded-lg" />
          <Skeleton className="h-12 flex-1 rounded-lg" />
        </div>
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>

      {/* About section */}
      <div className="space-y-sm">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}
