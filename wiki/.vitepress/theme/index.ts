import DefaultTheme from 'vitepress/theme'
import { useRoute } from 'vitepress'
import { nextTick, onMounted, onUnmounted, watch } from 'vue'
import mediumZoom, { type Zoom } from 'medium-zoom'
import './custom.css'

// Dark Mermaid palette — kept in step with `mermaid.themeVariables` in config.mts.
const NODE_FILL = '#2d333b'
const NODE_BORDER = '#6d5dfc'
const TEXT = '#e6edf3'
const CLUSTER_FILL = '#161b22'
const CLUSTER_BORDER = '#30363d'
const LINE = '#8b949e'

// --- Layer 3 of the dark-mode fix: rewrite Mermaid's inline styles ------------
// Mermaid writes `style="fill:…"` straight onto SVG elements (from `style` and
// `classDef` lines in a diagram), which beats both theme variables and CSS.
function fixMermaidInlineStyles(root: ParentNode = document): void {
  root.querySelectorAll<SVGElement>('.mermaid svg [style]').forEach((el) => {
    const s = el.style
    const inCluster = !!el.closest('.cluster')
    const isEdge = !!el.closest('.edgePaths, .edgePath, .flowchart-link') || el.classList.contains('flowchart-link')
    const isText = el.tagName === 'text' || el.tagName === 'tspan' || !!el.closest('.label, .nodeLabel, .edgeLabel')

    if (isText) {
      if (s.fill) s.fill = TEXT
      if (s.color) s.color = TEXT
      return
    }
    if (isEdge) {
      if (s.stroke) s.stroke = LINE
      return
    }
    if (s.fill && s.fill !== 'none') s.fill = inCluster && !el.closest('.node') ? CLUSTER_FILL : NODE_FILL
    if (s.stroke && s.stroke !== 'none') s.stroke = inCluster && !el.closest('.node') ? CLUSTER_BORDER : NODE_BORDER
    if (s.color) s.color = TEXT
  })
}

// Mermaid renders asynchronously after mount, so poll for a while.
function pollMermaidFix(): void {
  let attempts = 0
  const timer = setInterval(() => {
    fixMermaidInlineStyles()
    if (++attempts >= 20) clearInterval(timer)
  }, 500)
}

// --- Click-to-zoom for Mermaid diagrams (SVG overlay with pan and zoom) ------
const MIN_SCALE = 0.2
const MAX_SCALE = 8

function openMermaidOverlay(source: Element): void {
  const svg = source.querySelector('svg')
  if (!svg || document.querySelector('.mermaid-zoom-overlay')) return

  const overlay = document.createElement('div')
  overlay.className = 'mermaid-zoom-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'Zoomed diagram')

  const toolbar = document.createElement('div')
  toolbar.className = 'mermaid-zoom-toolbar'
  const button = (label: string, title: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.title = title
    b.setAttribute('aria-label', title)
    toolbar.appendChild(b)
    return b
  }
  const zoomOutBtn = button('−', 'Zoom out')
  const resetBtn = button('Reset', 'Reset view')
  const zoomInBtn = button('+', 'Zoom in')
  const closeBtn = button('✕', 'Close (Esc)')

  const stage = document.createElement('div')
  stage.className = 'mermaid-zoom-stage'
  const canvas = document.createElement('div')
  canvas.className = 'mermaid-zoom-canvas mermaid'
  const clone = svg.cloneNode(true) as SVGSVGElement
  // Let the clone size itself to the viewport rather than Mermaid's max-width.
  clone.removeAttribute('width')
  clone.removeAttribute('height')
  clone.style.maxWidth = 'none'
  clone.style.width = '100%'
  clone.style.height = '100%'
  canvas.appendChild(clone)
  stage.appendChild(canvas)

  const hint = document.createElement('div')
  hint.className = 'mermaid-zoom-hint'
  hint.textContent = 'Scroll to zoom · drag to pan · Esc to close'

  overlay.append(toolbar, stage, hint)
  document.body.appendChild(overlay)
  document.documentElement.classList.add('mermaid-zoom-open')

  let scale = 1
  let x = 0
  let y = 0
  const apply = () => {
    canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  }
  const zoomAt = (factor: number, cx: number, cy: number) => {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor))
    const rect = stage.getBoundingClientRect()
    // Keep the point under the cursor fixed while zooming.
    const px = cx - rect.left - rect.width / 2
    const py = cy - rect.top - rect.height / 2
    x = px - ((px - x) * next) / scale
    y = py - ((py - y) * next) / scale
    scale = next
    apply()
  }
  const zoomCentre = (factor: number) => {
    const rect = stage.getBoundingClientRect()
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }
  const reset = () => {
    scale = 1
    x = 0
    y = 0
    apply()
  }

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY)
    },
    { passive: false },
  )

  let dragging = false
  let lastX = 0
  let lastY = 0
  stage.addEventListener('pointerdown', (e) => {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    stage.setPointerCapture(e.pointerId)
    stage.classList.add('is-dragging')
  })
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return
    x += e.clientX - lastX
    y += e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    apply()
  })
  const endDrag = (e: PointerEvent) => {
    dragging = false
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId)
    stage.classList.remove('is-dragging')
  }
  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', endDrag)
  stage.addEventListener('dblclick', reset)

  const close = () => {
    overlay.remove()
    document.documentElement.classList.remove('mermaid-zoom-open')
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
    else if (e.key === '+' || e.key === '=') zoomCentre(1.25)
    else if (e.key === '-') zoomCentre(1 / 1.25)
    else if (e.key === '0') reset()
  }
  document.addEventListener('keydown', onKey)

  zoomInBtn.addEventListener('click', () => zoomCentre(1.25))
  zoomOutBtn.addEventListener('click', () => zoomCentre(1 / 1.25))
  resetBtn.addEventListener('click', reset)
  closeBtn.addEventListener('click', close)
  // Clicking the dark backdrop (not the diagram) closes the overlay.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === stage) close()
  })

  closeBtn.focus()
  apply()
}

function onDocumentClick(e: MouseEvent): void {
  const target = e.target as Element | null
  if (!target || target.closest('.mermaid-zoom-overlay')) return
  const diagram = target.closest('.vp-doc .mermaid')
  if (diagram) openMermaidOverlay(diagram)
}

// --- Theme --------------------------------------------------------------------

export default {
  extends: DefaultTheme,
  // setup(), not enhanceApp(): the DOM does not exist during SSR.
  setup() {
    const route = useRoute()
    let zoom: Zoom | undefined
    let observer: MutationObserver | undefined

    const initImageZoom = () => {
      zoom?.detach()
      zoom = mediumZoom('.vp-doc img:not(.no-zoom):not(a img)', {
        background: 'rgba(13, 17, 23, 0.92)',
        margin: 24,
      })
    }

    onMounted(() => {
      document.addEventListener('click', onDocumentClick)
      // Mermaid re-renders when the colour scheme toggles; re-apply the fix then.
      observer = new MutationObserver((mutations) => {
        if (mutations.some((m) => (m.target as Element).closest?.('.mermaid'))) fixMermaidInlineStyles()
      })
      observer.observe(document.body, { childList: true, subtree: true })
      pollMermaidFix()
      initImageZoom()
    })

    watch(
      () => route.path,
      () =>
        nextTick(() => {
          pollMermaidFix()
          initImageZoom()
        }),
    )

    onUnmounted(() => {
      document.removeEventListener('click', onDocumentClick)
      observer?.disconnect()
      zoom?.detach()
    })
  },
}
