import { createRequestContext, type RequestContext } from "@/shared/context/request-context"
import { AppError } from "@/shared/errors"

/**
 * `createRequestContext()` for a page inside `(app)`, with the one failure
 * the layout is already recovering from turned into a value.
 *
 * A session with no active organization — a user in the moment between
 * signing up and `OpenSoleWorkspace` setting one — throws `FORBIDDEN`.
 * The layout catches that and renders the opener, but Next.js renders a
 * layout and its page concurrently, so the page is already running and
 * would throw for the same reason at the same moment. That surfaces as a
 * logged server error and a wasted error boundary for a state that is
 * ordinary and already handled one level up.
 *
 * A page that gets `"no-active-organization"` should render nothing: the
 * layout is showing the user what to do about it.
 *
 * Only this case is converted. A `FORBIDDEN` from `assertCan` further in
 * — a viewer reaching for something they may not have — is a different
 * fact and still throws.
 */
export async function resolveActiveContext(): Promise<RequestContext | "no-active-organization"> {
  try {
    return await createRequestContext()
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") {
      return "no-active-organization"
    }
    throw error
  }
}
