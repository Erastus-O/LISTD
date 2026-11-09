'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  open: boolean
  onClose: () => void
  /** Called with the captured JPEG. */
  onCapture: (file: File) => void
}

/**
 * In-page camera using `getUserMedia`. The live preview + capture happen
 * inside the page (a `<video>` + `<canvas>`), so — unlike `<input capture>` —
 * the browser never hands off to the native camera app and can't evict/reload
 * the page mid-capture. Requires HTTPS + a user gesture (both satisfied here).
 *
 * Falls back gracefully: if the camera can't be accessed (permission denied,
 * no camera, unsupported), it shows an error and a "use the photo library"
 * hint instead of failing silently.
 */
export function CameraCapture({ open, onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const start = async () => {
      setError(null)
      setStarting(true)
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera not supported on this device/browser')
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Could not access the camera'
          )
        }
      } finally {
        if (!cancelled) setStarting(false)
      }
    }
    void start()
    return () => {
      cancelled = true
      stopStream()
    }
  }, [open, facing])

  function close() {
    stopStream()
    onClose()
  }

  function capture() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `photo-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        })
        onCapture(file)
        close()
      },
      'image/jpeg',
      0.9
    )
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm font-medium">Take a photo</span>
        <button
          type="button"
          onClick={close}
          aria-label="Close camera"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {error ? (
          <div className="max-w-xs px-6 text-center text-sm text-white/90">
            <p className="font-medium">Camera unavailable</p>
            <p className="mt-1 text-white/70">{error}</p>
            <p className="mt-3 text-white/70">
              Close this and use the <strong>Add</strong> button to pick a photo
              from your device instead.
            </p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-contain"
            />
            {starting && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-center gap-8 px-4 py-6">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() =>
            setFacing((f) => (f === 'environment' ? 'user' : 'environment'))
          }
          disabled={!!error || starting}
          aria-label="Switch camera"
          className="h-11 w-11 rounded-full text-white hover:bg-white/10"
        >
          <RefreshCw className="h-5 w-5" />
        </Button>
        <button
          type="button"
          onClick={capture}
          disabled={!!error || starting}
          aria-label="Capture photo"
          className="h-16 w-16 rounded-full border-4 border-white bg-white/20 transition-transform active:scale-95 disabled:opacity-40"
        />
        <span className="h-11 w-11" aria-hidden /> {/* spacer to centre shutter */}
      </div>
    </div>
  )
}
