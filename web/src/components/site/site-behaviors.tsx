'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { toast } from 'sonner'

const REVEAL =
  '.s-head, .s-life > div, .s-split > *, .s-svcard, .s-fact, .s-tier, .s-step, .s-value, .s-trustlist li, .s-clean, .s-ccard, .s-levels .s-lv, .s-faq, .s-cta, .ld-tablewrap, .s-form'

function countUp(el: Element) {
  const v = el.querySelector<HTMLElement>('.v')
  if (!v || v.dataset.done) return
  v.dataset.done = '1'
  const txt = v.textContent ?? ''
  const nums = txt.match(/\d+/g)
  if (!nums) return
  const t0 = performance.now()
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / 1100)
    const e = 1 - Math.pow(1 - k, 3)
    let i = 0
    v.textContent = txt.replace(/\d+/g, () => String(Math.round(Number(nums[i++]) * e)))
    if (k < 1) requestAnimationFrame(step)
    else v.textContent = txt
  }
  requestAnimationFrame(step)
}

/**
 * Website behaviours that act on the server-rendered markup: accordions, copy
 * buttons, scroll progress, scroll reveal, stage highlights and tilt. Ported
 * from the prototype's site.js and motion.js.
 *
 * Reveal only hides content after `m-on` is set here, so with JavaScript off
 * (or reduced motion) everything is simply visible.
 */
export function SiteBehaviors() {
  const pathname = usePathname()

  // Delegated, so these keep working across client-side navigations.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as Element

      const accBtn = target.closest<HTMLButtonElement>('.s-acc > div > button')
      if (accBtn) {
        const acc = accBtn.closest('.s-acc') as Element
        const open = accBtn.getAttribute('aria-expanded') === 'true'
        acc.querySelectorAll<HTMLButtonElement>(':scope > div > button').forEach((b) => {
          b.setAttribute('aria-expanded', 'false')
          ;(b.nextElementSibling as HTMLElement).hidden = true
        })
        if (!open) {
          accBtn.setAttribute('aria-expanded', 'true')
          const body = accBtn.nextElementSibling as HTMLElement
          body.hidden = false
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            body.animate(
              [
                { height: '0px', opacity: 0 },
                { height: `${body.scrollHeight}px`, opacity: 1 },
              ],
              { duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)' }
            )
          }
        }
        return
      }

      const copy = target.closest('[data-copy]')
      if (copy) {
        const src = copy.parentElement?.querySelector('[data-copy-src]')
        const text = src?.textContent ?? ''
        navigator.clipboard
          .writeText(text)
          .then(() => toast.success(`Copied ${text}`))
          .catch(() => toast.error(`Couldn’t copy. The address is ${text}`))
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  // Scroll progress bar + header shadow.
  useEffect(() => {
    const bar = document.createElement('div')
    bar.className = 'm-scrollbar'
    bar.setAttribute('aria-hidden', 'true')
    document.body.appendChild(bar)
    let ticking = false
    const update = () => {
      ticking = false
      const h = document.documentElement.scrollHeight - window.innerHeight
      const p = h > 0 ? window.scrollY / h : 0
      bar.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`
      document.querySelector('.s-hdr')?.classList.toggle('is-scrolled', window.scrollY > 8)
    }
    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(update)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      window.removeEventListener('scroll', onScroll)
      bar.remove()
    }
  }, [])

  // Per-page: reveal, lifecycle highlight, tilt.
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const root = document.documentElement
    const cleanups: Array<() => void> = []
    if (reduce) return

    root.classList.add('m-on')
    cleanups.push(() => root.classList.remove('m-on'))

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return
          e.target.classList.add('m-in')
          io.unobserve(e.target)
          if (e.target.classList.contains('s-fact')) countUp(e.target)
        })
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    )
    cleanups.push(() => io.disconnect())
    document.querySelectorAll(REVEAL).forEach((el) => {
      const sib = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0
      ;(el as HTMLElement).style.setProperty('--m-d', `${Math.min(sib, 6) * 0.07}s`)
      el.classList.add('m-rv')
      const r = el.getBoundingClientRect()
      if (r.top < window.innerHeight * 0.95 && r.bottom > 0) el.classList.add('m-in')
      else io.observe(el)
    })
    // Always ends visible, whatever the observer does.
    const safety = window.setTimeout(() => {
      document.querySelectorAll('.m-rv:not(.m-in)').forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('m-in')
      })
    }, 2500)
    cleanups.push(() => window.clearTimeout(safety))

    const life = Array.from(document.querySelectorAll<HTMLElement>('.s-life > div'))
    if (life.length) {
      let i = 2
      const set = (n: number) => {
        life.forEach((d, k) => d.classList.toggle('hot', k === n))
        i = n
      }
      const timer = window.setInterval(() => set((i + 1) % life.length), 2600)
      cleanups.push(() => window.clearInterval(timer))
    }

    if (window.matchMedia('(pointer: fine)').matches) {
      document.querySelectorAll<HTMLElement>('.s-evimg img, .s-proimg > img').forEach((el) => {
        el.classList.add('m-tilt')
        const host = el.parentElement as HTMLElement
        const move = (e: PointerEvent) => {
          const r = el.getBoundingClientRect()
          const x = (e.clientX - r.left) / r.width - 0.5
          const y = (e.clientY - r.top) / r.height - 0.5
          el.style.transform = `perspective(1000px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg)`
        }
        const leave = () => {
          el.style.transform = ''
        }
        host.addEventListener('pointermove', move)
        host.addEventListener('pointerleave', leave)
        cleanups.push(() => {
          host.removeEventListener('pointermove', move)
          host.removeEventListener('pointerleave', leave)
        })
      })
    }

    return () => cleanups.forEach((fn) => fn())
  }, [pathname])

  return null
}
