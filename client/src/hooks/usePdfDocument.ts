// ============================================================
// PAYROLL GANG SUITE — usePdfDocument
//
// Hook lifecycle PDF.js lato client: carica un PDF (bytes) in un
// worker dedicato e offre un renderer su <canvas>. Pattern di pulizia
// bloccato in Gate 2 (no Comlink/pool — niente worker condivisi):
//   • cancelled-flag      → ignora risposte stale dopo unmount/cambio file
//   • loadingTask.destroy → interrompe caricamento+worker, qualunque sia lo
//                           stato (PDFDocumentProxy.destroy() è literalmente
//                           `return this.loadingTask.destroy()` — pdf.mjs:11721,
//                           stessa operazione, non due da concatenare)
//   • renderTask.cancel   → interrompe un render pagina in corso
//                           (RenderingCancelledException attesa, non errore)
//
// Worker: NON workerPort condiviso. PDFWorker.fromPort mette in cache
// l'istanza per porta e loadingTask.destroy() la termina SEMPRE
// (pdf.mjs:11567/12394) → il giro successivo trova una porta "in fase di
// distruzione" e lancia "the worker is being destroyed" (pdf.mjs:12406).
// Con <React.StrictMode> (mount→unmount→mount, vedi main.tsx) l'effect
// viene quasi sempre cancellato PRIMA che loadingTask risolva: un worker
// condiviso romperebbe il primo caricamento ad ogni mount, sistematicamente.
// → GlobalWorkerOptions.workerSrc (URL, `?url` Vite — bundle dedicato per
// caricamento, costo trascurabile per un editor ad uso saltuario, e zero
// stato condiviso = zero race) anziché `?worker` + workerPort.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getDocument, GlobalWorkerOptions, RenderingCancelledException,
  type PDFDocumentProxy, type RenderTask,
} from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/** Geometria nativa pagina a scale 1, rotazione inclusa — mirror server PageGeometry (senza pageIndex). */
export interface PdfPageGeometry {
  widthPt:  number
  heightPt: number
  rotation: 0 | 90 | 180 | 270
}

export interface UsePdfDocumentResult {
  isLoading:  boolean
  loadError:  string | null
  numPages:   number
  /**
   * Renderizza pageIndex (0-based) sul canvas alla scala data. Annulla da sé
   * un eventuale render precedente ancora in volo — sicuro da richiamare a
   * ogni cambio pagina/zoom senza orchestrare manualmente le race condition.
   * Ritorna la geometria nativa (per la conversione regioni-percentuale) o
   * null se annullato/documento assente.
   */
  renderPage: (pageIndex: number, canvas: HTMLCanvasElement, scale: number) => Promise<PdfPageGeometry | null>
}

export function usePdfDocument(bytes: Uint8Array | null): UsePdfDocumentResult {
  const [isLoading, setLoading]   = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [numPages, setNumPages]   = useState(0)

  const docRef        = useRef<PDFDocumentProxy | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)

  useEffect(() => {
    let cancelled = false
    setNumPages(0)
    setLoadError(null)
    docRef.current = null

    if (!bytes) { setLoading(false); return }

    setLoading(true)
    const loadingTask = getDocument({
      data:            bytes,
      isEvalSupported: false, // CSP: script-src senza 'unsafe-eval' — necessario, non solo difesa
    })

    loadingTask.promise.then(
      doc => {
        if (cancelled) { void doc.destroy(); return }
        docRef.current = doc
        setNumPages(doc.numPages)
        setLoading(false)
      },
      () => {
        if (cancelled) return
        setLoadError('PDF non leggibile o danneggiato — verifica il file e riprova.')
        setLoading(false)
      },
    )

    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
      void loadingTask.destroy() // copre sia "ancora in caricamento" sia "documento pronto"
      docRef.current = null
    }
  }, [bytes])

  const renderPage = useCallback(async (
    pageIndex: number, canvas: HTMLCanvasElement, scale: number,
  ): Promise<PdfPageGeometry | null> => {
    const doc = docRef.current
    if (!doc) return null

    renderTaskRef.current?.cancel()
    renderTaskRef.current = null

    try {
      const page     = await doc.getPage(pageIndex + 1) // pdfjs è 1-based
      const viewport = page.getViewport({ scale })
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      canvas.width  = viewport.width
      canvas.height = viewport.height

      const task = page.render({ canvasContext: ctx, viewport })
      renderTaskRef.current = task
      await task.promise
      if (renderTaskRef.current === task) renderTaskRef.current = null

      // Geometria "naturale" (rotazione di pagina inclusa, scale 1) — stesso
      // spazio percentuale in cui vengono salvate le RegionRect (mirror
      // server extractor.ts: viewport.convertToViewportPoint).
      const native = page.getViewport({ scale: 1 })
      return { widthPt: native.width, heightPt: native.height, rotation: native.rotation as 0 | 90 | 180 | 270 }
    } catch (err) {
      if (err instanceof RenderingCancelledException) return null // annullamento atteso, non un errore
      throw err
    }
  }, [])

  return { isLoading, loadError, numPages, renderPage }
}
