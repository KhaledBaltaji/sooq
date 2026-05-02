import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <div className="px-md py-lg space-y-md">
      <Skeleton className="h-8 w-48" />
      <div className="space-y-sm">
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-36 rounded-lg" />
      </div>
    </div>
  );
}
