import { GeneratedAvatar } from "@/components/ui/generated-avatar";

interface AvatarProps {
  name: string;
  userId?: string;
  src?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeMap = { sm: 32, md: 40, lg: 48, xl: 64 };
const sizeClasses = {
  sm: "w-8 h-8",
  md: "w-10 h-10",
  lg: "w-12 h-12",
  xl: "w-16 h-16",
};

export function Avatar({ name, userId, src, size = "md", className }: AvatarProps) {
  const px = sizeMap[size];

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${sizeClasses[size]} rounded-full object-cover shrink-0 ${className || ""}`}
      />
    );
  }

  return (
    <GeneratedAvatar
      seed={userId || name}
      size={px}
      className={`rounded-full shrink-0 ${className || ""}`}
    />
  );
}
