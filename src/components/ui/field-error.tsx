export interface FieldErrorProps {
  id: string
  message?: string | undefined
}

/** Visible validation message for one field. Renders nothing when there is no error. */
export function FieldError({ id, message }: FieldErrorProps) {
  if (!message) {
    return null
  }

  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-danger">
      {message}
    </p>
  )
}
