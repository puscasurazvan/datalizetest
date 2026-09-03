import Link from "next/link"

import { Brand } from "@/components/brand"

import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"

/**
 * Deliberately NOT the refusal treatment (DESIGN.md): a missing route is a
 * navigation mistake, not a query the product refused to run, so there is
 * no rose accent and no warning icon here.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-space-lg bg-canvas px-gutter-mobile py-space-3xl">
      <div className="flex w-full max-w-sm flex-col gap-space-xl">
        <div className="flex justify-center">
          <Brand />
        </div>
        <Card>
          <CardHeader className="items-center gap-space-sm border-b border-hairline py-space-lg text-center">
            <span className="font-mono text-headline-lg text-ink-faint">404</span>
            <h1 className="text-headline-md text-ink">Page not found</h1>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-body-sm text-ink-muted">
              The page you&apos;re looking for doesn&apos;t exist or has moved.
            </p>
          </CardContent>
          <CardFooter className="flex justify-center border-t border-hairline pt-space-base">
            <Link href="/datasets" className={buttonVariants({ variant: "outline" })}>
              Back to datasets
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
