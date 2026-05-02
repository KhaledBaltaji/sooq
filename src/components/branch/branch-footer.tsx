import Link from "next/link";

export function BranchFooter({ branchName }: { branchName: string }) {
  return (
    <footer className="border-t border-border-custom mt-16 py-8">
      <div className="max-w-[1240px] mx-auto px-4 lg:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-custom">
        <p>
          &copy; {new Date().getFullYear()} {branchName}
        </p>
        <p>
          Powered by{" "}
          <Link
            href="https://sooq.exchange"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-text hover:underline"
          >
            sooq
          </Link>
        </p>
      </div>
    </footer>
  );
}
