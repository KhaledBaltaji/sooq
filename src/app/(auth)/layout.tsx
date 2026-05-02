export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg relative overflow-hidden">
      {/* Backdrop blur effect — simulates looking through frosted glass at the app */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-2xl" />
      </div>

      {/* Auth card container */}
      <main className="relative z-20 min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-[420px]">
          {children}
        </div>
      </main>
    </div>
  );
}
