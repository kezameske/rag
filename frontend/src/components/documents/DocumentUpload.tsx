import { useCallback, useState } from 'react'
import { uploadDocument } from '@/lib/api'

const ALLOWED_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.html', '.csv']

interface DocumentUploadProps {
  onUploadComplete: () => void
}

export function DocumentUpload({ onUploadComplete }: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploadFileName, setUploadFileName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const validateFile = (file: File): string | null => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
    }
    if (file.size > 50 * 1024 * 1024) {
      return 'File too large. Maximum size is 50 MB.'
    }
    return null
  }

  const handleUpload = async (files: FileList | File[]) => {
    setError(null)
    const fileArray = Array.from(files)

    for (const file of fileArray) {
      const validationError = validateFile(file)
      if (validationError) {
        setError(validationError)
        return
      }
    }

    setUploading(true)
    try {
      for (const file of fileArray) {
        setUploadFileName(file.name)
        setProgress(0)
        await uploadDocument(file, (percent) => setProgress(percent))
      }
      onUploadComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      setProgress(0)
      setUploadFileName('')
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files)
    }
  }, [])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(e.target.files)
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/50'
        }`}
        onClick={() => !uploading && document.getElementById('file-upload')?.click()}
      >
        <input
          id="file-upload"
          type="file"
          className="hidden"
          accept=".txt,.md,.pdf,.docx,.doc,.xlsx,.xls,.html,.csv"
          multiple
          onChange={handleFileInput}
          disabled={uploading}
        />
        <div className="space-y-2">
          {uploading ? (
            <>
              <p className="text-sm font-medium">Uploading {uploadFileName}...</p>
              <div className="mx-auto max-w-xs">
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{progress}%</p>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Drop files here or click to upload</p>
              <p className="text-xs text-muted-foreground">
                Supported: .txt, .md, .pdf, .docx, .xlsx, .html, .csv (max 50 MB)
              </p>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className={`text-sm p-3 rounded-md ${
          error.includes('Duplicate content')
            ? 'bg-yellow-50 text-yellow-800 border border-yellow-200'
            : 'text-destructive'
        }`}>
          {error}
        </div>
      )}
    </div>
  )
}
