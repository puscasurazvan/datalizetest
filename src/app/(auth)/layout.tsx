export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-semibold tracking-tight text-foreground">
          Datalize
        </p>
        {children}
      </div>
    </div>
  )
}
