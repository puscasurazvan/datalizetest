"use client"

import { CloudUpload, FileText } from "lucide-react"
import { useId, useState, type ChangeEvent, type DragEvent } from "react"

/**
 * Human units for UI copy. A raw byte count belongs in a server error, where a
 * developer reads it — never in the dialog a person with a spreadsheet reads.
 */
export function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024)
  if (megabytes >= 1) {
    return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const ZONE =
  "flex flex-col items-center justify-center gap-space-sm rounded-xl border border-dashed px-space-lg py-space-xl text-center transition-colors has-[input:focus-visible]:border-cyan has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-cyan-solid/15"

const IDLE_TONE =
  "border-hairline-strong bg-surface-raised hover:border-cyan/60 hover:bg-surface-high"
const DRAGGING_TONE = "border-cyan bg-cyan-solid/10"

export interface CsvDropzoneProps {
  /** The file already chosen, or `null` while the zone is still empty. */
  readonly file: File | null
  readonly disabled: boolean
  readonly maxBytes: number
  /** Called for every candidate — the caller owns type and size validation. */
  readonly onSelect: (file: File) => void
}

/**
 * The uploader's target: click it or drop a file on it. It is a `<label>` for
 * a real `<input type="file">`, so the click, the keyboard, and the screen
 * reader all get the browser's own file control — no click forwarding, no
 * `role="button"` imitation.
 */
export function CsvDropzone({ file, disabled, maxBytes, onSelect }: CsvDropzoneProps) {
  const inputId = useId()
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    if (disabled) {
      return
    }
    // Without preventDefault on dragover the drop never fires at all and the
    // browser navigates to the file instead.
    event.preventDefault()
    setIsDraggingOver(true)
  }

  function handleDragLeave() {
    setIsDraggingOver(false)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDraggingOver(false)
    if (disabled) {
      return
    }
    const dropped = event.dataTransfer.files[0]
    if (dropped !== undefined) {
      onSelect(dropped)
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    // Clearing the value lets the same file be chosen again after it was
    // rejected — otherwise re-picking it fires no change event at all.
    event.target.value = ""
    if (selected !== undefined) {
      onSelect(selected)
    }
  }

  const tone = isDraggingOver ? DRAGGING_TONE : IDLE_TONE
  const state = disabled ? "pointer-events-none opacity-50" : "cursor-pointer"
  const contents =
    file === null ? <EmptyPrompt maxBytes={maxBytes} /> : <SelectedFile file={file} />

  return (
    <label
      htmlFor={inputId}
      data-testid="csv-dropzone"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`${ZONE} ${tone} ${state}`}
    >
      <input
        id={inputId}
        name="file"
        type="file"
        accept=".csv,text/csv"
        disabled={disabled}
        onChange={handleChange}
        className="sr-only"
      />
      {contents}
    </label>
  )
}

/**
 * `pointer-events-none` on both states is what keeps the drag highlight
 * steady: without it, dragging across the icon fires `dragleave` on the label.
 */
function EmptyPrompt({ maxBytes }: { maxBytes: number }) {
  return (
    <div className="pointer-events-none flex flex-col items-center gap-space-sm">
      <CloudUpload strokeWidth={1.5} className="size-6 text-cyan" />
      <span className="text-body-sm text-ink">
        Drop a CSV here, or <span className="text-cyan underline">browse</span>
      </span>
      <span className="font-mono text-label-mono text-ink-faint">
        CSV up to {formatBytes(maxBytes)}
      </span>
    </div>
  )
}

function SelectedFile({ file }: { file: File }) {
  return (
    <div className="pointer-events-none flex flex-col items-center gap-space-sm">
      <FileText strokeWidth={1.5} className="size-6 text-verified" />
      <span className="max-w-full truncate text-body-sm text-ink">{file.name}</span>
      <span className="font-mono text-label-mono text-ink-faint">
        {formatBytes(file.size)} · drop another to replace
      </span>
    </div>
  )
}
